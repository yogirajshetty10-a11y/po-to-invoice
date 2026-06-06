import type { ExtractedPO, LineItem, Party } from "./types";
import { stateName } from "./states";
import { COMPANY } from "./company";

const GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][0-9A-Z])\b/g;
const PAN_RE = /\b([A-Z]{5}\d{4}[A-Z])\b/g;

function toNum(s: string): number {
  const v = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(v) ? v : 0;
}

function blankParty(): Party {
  return { name: "", address: "", gstin: "", pan: "", stateName: "", stateCode: "", email: "", phone: "" };
}

function blankPO(): ExtractedPO {
  return {
    poNumber: "", poDate: "", deliveryDate: "", paymentTerms: "",
    reference: "", referenceDate: "", currency: "INR",
    vendor: blankParty(), buyer: blankParty(), shipTo: blankParty(),
    items: [],
    taxableValue: 0, igstRate: 0, cgstRate: 0, sgstRate: 0, cessRate: 0,
    igstAmount: 0, cgstAmount: 0, sgstAmount: 0, cessAmount: 0,
    roundOff: 0, total: 0, notes: "",
  };
}

function applyGstin(party: Party, gstin: string) {
  party.gstin = gstin;
  party.stateCode = gstin.slice(0, 2);
  party.stateName = stateName(party.stateCode);
  party.pan = gstin.slice(2, 12);
}

function parseParty(block: string): Party {
  const p = blankParty();
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);

  const gstinIdx = lines.findIndex((l) => /GSTIN\s*:/i.test(l));
  const panIdx = lines.findIndex((l) => /\bPAN\s*:/i.test(l));
  const contactIdx = lines.findIndex((l) => /^Contact\s*:/i.test(l));

  const nameIdx = lines.findIndex((l) => !/^(Pod\s+Name|GSTIN|PAN|Contact|Billing|Shipping|Vendor)/i.test(l));
  if (nameIdx >= 0) p.name = lines[nameIdx];

  const addrEnd = [gstinIdx, panIdx, contactIdx, lines.findIndex((l) => /^Pod\s+Name/i.test(l))]
    .filter((i) => i > nameIdx)
    .reduce((a, b) => (a < 0 ? b : Math.min(a, b)), -1);
  const addrLines = addrEnd > nameIdx ? lines.slice(nameIdx + 1, addrEnd) : lines.slice(nameIdx + 1);
  p.address = addrLines.join("\n").trim();

  const gMatch = block.match(GSTIN_RE);
  if (gMatch && gMatch[0]) applyGstin(p, gMatch[0]);
  else {
    const panMatch = block.match(PAN_RE);
    if (panMatch && panMatch[0]) p.pan = panMatch[0];
  }
  return p;
}

function sliceBetween(text: string, start: RegExp, end: RegExp): string {
  const s = text.match(start);
  if (!s || s.index == null) return "";
  const rest = text.slice(s.index + s[0].length);
  const e = rest.match(end);
  return e && e.index != null ? rest.slice(0, e.index) : rest;
}

function extractMBLItems(region: string): LineItem[] {
  // Repair PDF extraction artifacts before tokenizing.
  let s = region.replace(/\s+/g, " ");
  // "59735. 59" → "59735.59"
  s = s.replace(/(\d)\.\s+(\d)/g, "$1.$2");
  // "1999.0 0" → "1999.00"  — merge only when the trailing digit is followed by whitespace or end,
  // never by "." (would glue onto the next number) or another digit.
  s = s.replace(/(\d+\.\d)\s+(\d)(?=\s|$)/g, "$1$2");
  // "18.00 %" → "18.00%"
  s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, "$1%");

  const tokens = s.split(" ").filter(Boolean);
  const items: LineItem[] = [];

  let i = 0;
  while (i < tokens.length - 1) {
    // Look for serial + item code
    if (/^\d{1,3}$/.test(tokens[i]) && /^\d{6,}$/.test(tokens[i + 1])) {
      const itemCode = tokens[i + 1];
      let j = i + 2;
      const descTokens: string[] = [];
      while (j < tokens.length && !/^\d{8}$/.test(tokens[j])) {
        descTokens.push(tokens[j]);
        j++;
        if (j - i > 60) break;
      }
      if (j >= tokens.length) break;
      const hsn = tokens[j];
      j++;

      // Collect up to next item boundary or end
      const block: string[] = [];
      while (j < tokens.length && block.length < 20) {
        if (/^\d{1,3}$/.test(tokens[j]) && j + 1 < tokens.length && /^\d{6,}$/.test(tokens[j + 1])) break;
        block.push(tokens[j]);
        j++;
      }

      // Expected: qty, mrp, baseCost, taxable, rate%, amt, rate%, amt, rate%, amt, rate%, amt, addCess, total
      const qty = Math.round(toNum(block[0] || "0"));
      const baseCost = toNum(block[2] || "0");
      const taxable = toNum(block[3] || "0");

      const pctIdx: number[] = [];
      block.forEach((tok, k) => {
        if (/%$/.test(tok)) pctIdx.push(k);
      });
      const igstR = pctIdx.length >= 3 ? parseFloat(block[pctIdx[2]]) : 0;
      const cgstR = pctIdx.length >= 1 ? parseFloat(block[pctIdx[0]]) : 0;
      const sgstR = pctIdx.length >= 2 ? parseFloat(block[pctIdx[1]]) : 0;
      const taxRate = igstR > 0 ? igstR : cgstR + sgstR;

      items.push({
        itemCode,
        description: descTokens.join(" ").replace(/\s+/g, " ").trim(),
        hsnCode: hsn,
        quantity: qty,
        rate: baseCost,
        amount: taxable > 0 ? taxable : Math.round(baseCost * qty * 100) / 100,
        taxRate,
      });

      i = j;
    } else {
      i++;
    }
  }
  return items;
}

function parseMBL(text: string): ExtractedPO {
  const out = blankPO();
  const norm = text.replace(/\r\n/g, "\n");

  // Top-level fields
  const poNum = norm.match(/PO\s*No\s*:\s*([A-Z0-9-]+)/i);
  if (poNum) out.poNumber = poNum[1].trim();

  const poDate = norm.match(/PO\s*Date\s*:\s*(\d{4}-\d{2}-\d{2})/i);
  if (poDate) out.poDate = poDate[1];

  const deliv = norm.match(/Expected\s+Delivery\s+Date\s*:\s*(\d{4}-\d{2}-\d{2})/i);
  if (deliv) out.deliveryDate = deliv[1];

  const pt = norm.match(/Payment\s+Terms\s*:\s*([^\n]+)/i);
  if (pt) out.paymentTerms = pt[1].trim();

  const ref = norm.match(/PO\s*Release\s*Date\s*:\s*([^\n]+)/i);
  if (ref) out.referenceDate = ref[1].trim();

  // Vendor block: "Vendor Name:" ... "PO No:"
  const vendorBlock = sliceBetween(norm, /Vendor\s+Name\s*:\s*/i, /PO\s*No\s*:/i);
  if (vendorBlock) out.vendor = parseParty(vendorBlock);

  // Addresses: "Billing Address" + "Shipping Address" headers, then two parallel blocks until items header.
  const addrBlock = sliceBetween(
    norm,
    /Billing\s+Address\s*Shipping\s+Address/i,
    /#\s*\n?\s*Item|Item\s*Code\s*Description/i,
  );
  if (addrBlock) {
    // In MBL POs both billing & shipping are the same MOKSH entity — the block repeats twice.
    // Split on the first duplicated company line (re-occurrence of the entity name).
    const lines = addrBlock.split("\n").map((l) => l.trim()).filter(Boolean);
    const firstName = lines[0] || "";
    const repeatIdx = firstName ? lines.findIndex((l, k) => k > 0 && l === firstName) : -1;
    const billLines = repeatIdx > 0 ? lines.slice(0, repeatIdx) : lines;
    const shipLines = repeatIdx > 0 ? lines.slice(repeatIdx) : lines;
    out.buyer = parseParty(billLines.join("\n"));
    out.shipTo = parseParty(shipLines.join("\n"));
  }

  // Totals
  const totalAmt = norm.match(/Total\s+Amount\s*\(INR\)\s*:?\s*([\d,]+\.\d+)/i);
  const totalTax = norm.match(/Total\s+Tax\s*\(INR\)\s*:?\s*([\d,]+\.\d+)/i);
  const grand = norm.match(/Grand\s+Total\s*\(INR\)\s*:?\s*([\d,]+\.\d+)/i);
  const words = norm.match(/Amount\s+in\s+Words\s*:?\s*([^\n]+)/i);
  if (totalAmt) out.taxableValue = toNum(totalAmt[1]);
  if (grand) out.total = toNum(grand[1]);

  // Items
  const itemsRegion = sliceBetween(norm, /Rate\s*Amt\s*\(INR\)/i, /Total\s+Amount\s*\(INR\)/i);
  if (itemsRegion) out.items = extractMBLItems(itemsRegion);

  // Tax: inter vs intra-state
  const isInter =
    out.vendor.stateCode && out.buyer.stateCode && out.vendor.stateCode !== out.buyer.stateCode;

  const itemTaxRate = out.items.find((it) => (it.taxRate || 0) > 0)?.taxRate || 0;
  const computedTax = totalTax
    ? toNum(totalTax[1])
    : Math.round(out.taxableValue * (itemTaxRate / 100) * 100) / 100;

  if (isInter) {
    out.igstRate = itemTaxRate || 18;
    out.igstAmount = computedTax;
  } else {
    out.cgstRate = (itemTaxRate || 18) / 2;
    out.sgstRate = (itemTaxRate || 18) / 2;
    out.cgstAmount = Math.round((computedTax / 2) * 100) / 100;
    out.sgstAmount = Math.round((computedTax - out.cgstAmount) * 100) / 100;
  }

  // Round-off so taxable + tax + roundOff === total
  const preRound = out.taxableValue + computedTax;
  out.roundOff = out.total ? Math.round((out.total - preRound) * 100) / 100 : 0;

  if (words) out.notes = "Amount in Words: " + words[1].trim();

  return out;
}

// ---------- Legacy / generic parser (kept for non-MBL formats) ----------

const MONTHS: Record<string, string> = {
  jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
  apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
  aug: "08", august: "08", sep: "09", sept: "09", september: "09", oct: "10", october: "10",
  nov: "11", november: "11", dec: "12", december: "12",
};

function parseTextDate(s: string): string {
  if (!s) return "";
  const m = s.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo) return `${m[3]}-${mo}-${m[2].padStart(2, "0")}`;
  }
  const m2 = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  return "";
}

function parseGeneric(text: string): ExtractedPO {
  const out = blankPO();
  const norm = text.replace(/\r\n/g, "\n");
  const lines = norm.split("\n").map((l) => l.trim());

  const poNum = norm.match(/P\.?\s*O\.?\s*Number\s*:?\s*([A-Za-z0-9-]+)/i);
  if (poNum) out.poNumber = poNum[1];

  const dateMatch = norm.match(/(?:^|\n)\s*Date\s*:\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
  if (dateMatch) out.poDate = parseTextDate(dateMatch[1]);

  const ptMatch = norm.match(/Payment\s+Terms\s*:\s*([^\n]+)/i);
  if (ptMatch) out.paymentTerms = ptMatch[1].trim();

  const netMatch = norm.match(/Net\s+amount\s+([\d,]+\.\d{2})/i);
  const totalMatch = norm.match(/Total\s+Amount\s+([\d,]+\.\d{2})/i);
  if (netMatch) out.total = toNum(netMatch[1]);
  else if (totalMatch) out.total = toNum(totalMatch[1]);

  const gstins = [...norm.matchAll(GSTIN_RE)].map((m) => m[1]);
  const pans = [...norm.matchAll(PAN_RE)].map((m) => m[1]);

  const purchaseOrderIdx = lines.findIndex((l) => /^Purchase\s+Order/i.test(l));
  if (purchaseOrderIdx >= 0) {
    for (let i = purchaseOrderIdx + 1; i < Math.min(purchaseOrderIdx + 4, lines.length); i++) {
      if (lines[i] && !/^PAN\s*:/i.test(lines[i]) && !/^CIN\s*:/i.test(lines[i])) {
        out.buyer.name = lines[i];
        break;
      }
    }
  }
  if (pans[0]) out.buyer.pan = pans[0];

  const vendorIdx = lines.findIndex((l) => /^Vendor\s*:/i.test(l));
  if (vendorIdx >= 0) {
    out.vendor.name = lines[vendorIdx].replace(/^Vendor\s*:\s*/i, "").trim();
    if (pans[1]) out.vendor.pan = pans[1];
  }

  if (out.vendor.pan) {
    const vGstin = gstins.find((g) => g.slice(2, 12) === out.vendor.pan);
    if (vGstin) applyGstin(out.vendor, vGstin);
  }
  if (out.buyer.pan) {
    const bGstin = gstins.find((g) => g.slice(2, 12) === out.buyer.pan);
    if (bGstin) applyGstin(out.buyer, bGstin);
  }

  if (out.total > 0) {
    const rate = 18;
    out.taxableValue = Math.round((out.total / (1 + rate / 100)) * 100) / 100;
    const tax = Math.round((out.total - out.taxableValue) * 100) / 100;
    const isInter = out.vendor.stateCode && out.buyer.stateCode && out.vendor.stateCode !== out.buyer.stateCode;
    if (isInter) {
      out.igstRate = rate;
      out.igstAmount = tax;
    } else {
      out.cgstRate = rate / 2;
      out.sgstRate = rate / 2;
      out.cgstAmount = Math.round((tax / 2) * 100) / 100;
      out.sgstAmount = tax - out.cgstAmount;
    }
  }
  return out;
}

// ---------- Blink Commerce parser ----------

function extractBlinkItems(region: string, isInter: boolean): LineItem[] {
  let s = region.replace(/\s+/g, " ");
  // Repair PDF column-shift artifacts in decimals. Iterate until stable so
  // patterns like "0 . 0 0" collapse via "0.0 0" → "0.00".
  for (let k = 0; k < 5; k++) {
    const before = s;
    s = s.replace(/(\d)\s*\.\s*(\d)/g, "$1.$2");
    s = s.replace(/(\d+\.\d)\s+(\d)(?=\s|$)/g, "$1$2");
    if (s === before) break;
  }
  const tokens = s.split(" ").filter(Boolean);

  // Locate serials (1, 2, 3, ...) followed by digit-run that begins the item code.
  const serialPositions: number[] = [];
  let nextSerial = 1;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === String(nextSerial) && /^\d{4,}$/.test(tokens[i + 1])) {
      serialPositions.push(i);
      nextSerial++;
    }
  }
  if (serialPositions.length === 0) return [];

  const items: LineItem[] = [];
  for (let k = 0; k < serialPositions.length; k++) {
    const start = serialPositions[k] + 1;
    const end = k + 1 < serialPositions.length ? serialPositions[k + 1] : tokens.length;
    const slice = tokens.slice(start, end);

    let idx = 0;
    const consumeDigits = (target: number): string => {
      let buf = "";
      while (idx < slice.length && /^\d+$/.test(slice[idx]) && buf.length < target) {
        buf += slice[idx];
        idx++;
        if (buf.length >= target) break;
      }
      return buf;
    };
    const itemCode = consumeDigits(8);
    const hsn = consumeDigits(8);
    consumeDigits(12); // UPC, discarded

    const descTokens: string[] = [];
    while (idx < slice.length && !/^\d+\.\d+$/.test(slice[idx])) {
      descTokens.push(slice[idx]);
      idx++;
    }

    // Numeric fields, front-anchored. Layout from the left is stable:
    //   basicCost, <rate cols>, cess%, addCess, taxAmt, landingRate, qty, mrp, margin%, totalAmt
    // The rate-column count is the only variable: inter-state POs carry one
    // IGST% column, intra-state POs carry two (CGST% + SGST%). We anchor from the
    // FRONT (not the end) because PDF extraction sometimes splits the trailing
    // total (e.g. "36315.00" → "3631" + "5.00"), which would shift end-relative
    // indices. qty therefore sits at index (rateCols + 5):
    //   0:basicCost  1..rateCols:tax%  +1:cess%  +1:addCess  +1:taxAmt  +1:landing  → qty
    const fields: number[] = [];
    while (idx < slice.length && fields.length < 14) {
      const t = slice[idx];
      if (/^\d+(?:\.\d+)?$/.test(t)) fields.push(parseFloat(t));
      idx++;
    }

    const basicCost = fields[0] || 0;
    const rateCols = isInter ? 1 : 2;
    let taxRate = 0;
    for (let r = 1; r <= rateCols && r < fields.length; r++) taxRate += fields[r] || 0;
    const qty = Math.round(fields[rateCols + 5] || 0);

    items.push({
      itemCode,
      description: descTokens.join(" ").replace(/\s+/g, " ").trim(),
      hsnCode: hsn,
      quantity: qty,
      rate: basicCost,
      amount: Math.round(basicCost * qty * 100) / 100,
      taxRate,
    });
  }
  return items;
}

function parseBlink(text: string): ExtractedPO {
  const out = blankPO();
  const norm = text.replace(/\r\n/g, "\n");

  // Top-level fields
  const poNum = norm.match(/P\.?\s*O\.?\s*Number\s*:\s*([A-Za-z0-9-]+)/i);
  if (poNum) out.poNumber = poNum[1].trim();

  const dateMatch = norm.match(/(?:^|\n)\s*Date\s*:\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
  if (dateMatch) out.poDate = parseTextDate(dateMatch[1]);

  const delivMatch = norm.match(/PO\s+delivery\s+date\s*:\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
  if (delivMatch) out.deliveryDate = parseTextDate(delivMatch[1]);

  const ptMatch = norm.match(/Payment\s+Terms\s*:\s*([^\n]+)/i);
  if (ptMatch) out.paymentTerms = ptMatch[1].trim();

  // Vendor — pull name + GSTIN; address comes from COMPANY static below.
  const vendorMatch = norm.match(/Vendor\s*:\s*([^\n]+)/i);
  if (vendorMatch) out.vendor.name = vendorMatch[1].trim();

  // The PO has two GSTINs: vendor's appears before "Delivered To", buyer's after.
  const deliveredToIdx = norm.search(/Delivered\s*\n?\s*To\s*:/i);
  const beforeDelivered = deliveredToIdx > 0 ? norm.slice(0, deliveredToIdx) : norm;
  const afterDelivered = deliveredToIdx > 0 ? norm.slice(deliveredToIdx) : "";

  const vendorGstin = beforeDelivered.match(GSTIN_RE);
  if (vendorGstin && vendorGstin[0]) applyGstin(out.vendor, vendorGstin[0]);

  // Buyer / ship-to from "Delivered To :" block.
  const buyerNameMatch = norm.match(/Purchase\s+Order\s*\n+\s*([^\n]+)/i);
  if (buyerNameMatch) out.buyer.name = buyerNameMatch[1].trim();

  // "Delivered\nTo : <NAME>\n<ADDR LINES>\nGST No. : <GSTIN>"
  if (afterDelivered) {
    const block = afterDelivered.match(
      /Delivered\s*\n?\s*To\s*:\s*([^\n]*)\n([\s\S]*?)(?:GST\s*No\.?\s*:|Reference\s*:)/i,
    );
    if (block) {
      const shipName = block[1].trim();
      const shipAddr = block[2]
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n");
      out.shipTo.name = shipName || out.buyer.name;
      out.shipTo.address = shipAddr;
      // Buyer bill-to mirrors ship-to in Blink POs (no separate billing block).
      if (!out.buyer.name) out.buyer.name = out.shipTo.name;
      out.buyer.address = shipAddr;
    }
    const buyerGstin = afterDelivered.match(GSTIN_RE);
    if (buyerGstin && buyerGstin[0]) {
      applyGstin(out.buyer, buyerGstin[0]);
      applyGstin(out.shipTo, buyerGstin[0]);
    }
  }

  // Items — inter vs intra-state decides the tax-column layout (IGST vs CGST+SGST),
  // so resolve it from the now-applied GSTINs before tokenizing the rows.
  const isInterState =
    !!out.vendor.stateCode && !!out.buyer.stateCode && out.vendor.stateCode !== out.buyer.stateCode;
  const itemsRegion = sliceBetween(norm, /#\s*Item[\s\S]*?Total\s*\n?\s*Amt/i, /Total\s+Quantity\s*:/i);
  if (itemsRegion) out.items = extractBlinkItems(itemsRegion, isInterState);

  // Totals
  const netMatch = norm.match(/Net\s+amount\s+([\d,]+\.\d{2})/i);
  const totalMatch = norm.match(/Total\s+Amount\s+([\d,]+\.\d{2})/i);
  if (netMatch) out.total = toNum(netMatch[1]);
  else if (totalMatch) out.total = toNum(totalMatch[1]);

  // Derive taxable from item rows if parsed, else back-solve from total at line-rate or 18%.
  const itemTaxRate = out.items.find((it) => (it.taxRate || 0) > 0)?.taxRate || 18;
  const itemsTaxable = out.items.reduce((s, it) => s + (it.amount || 0), 0);
  if (itemsTaxable > 0) {
    out.taxableValue = Math.round(itemsTaxable * 100) / 100;
  } else if (out.total > 0) {
    out.taxableValue = Math.round((out.total / (1 + itemTaxRate / 100)) * 100) / 100;
  }

  // Compute tax strictly as rate% of taxable value; any per-unit-rounding gap
  // in the PO falls into Round Off so the GST invoice math stays clean.
  const tax = Math.round(out.taxableValue * (itemTaxRate / 100) * 100) / 100;

  const isInter =
    out.vendor.stateCode && out.buyer.stateCode && out.vendor.stateCode !== out.buyer.stateCode;
  if (isInter) {
    out.igstRate = itemTaxRate;
    out.igstAmount = tax;
  } else {
    out.cgstRate = itemTaxRate / 2;
    out.sgstRate = itemTaxRate / 2;
    out.cgstAmount = Math.round((tax / 2) * 100) / 100;
    out.sgstAmount = Math.round((tax - out.cgstAmount) * 100) / 100;
  }

  out.roundOff = out.total
    ? Math.round((out.total - out.taxableValue - tax) * 100) / 100
    : 0;

  return out;
}

// ---------- Entry point: auto-detect format ----------

function hydrateClapstoreVendor(po: ExtractedPO): ExtractedPO {
  // If the PO's vendor is Clapstore, fill in canonical address + GSTIN from COMPANY.
  const isClapstore =
    /clapstore/i.test(po.vendor.name || "") ||
    po.vendor.pan === COMPANY.pan ||
    po.vendor.gstin === COMPANY.gstin;
  if (isClapstore) {
    po.vendor = {
      ...po.vendor,
      name: COMPANY.name,
      address: po.vendor.address || COMPANY.address,
      gstin: COMPANY.gstin,
      pan: COMPANY.pan,
      stateName: COMPANY.stateName,
      stateCode: COMPANY.stateCode,
    };
  }
  return po;
}

export function parsePOText(text: string): ExtractedPO {
  if (!text) return blankPO();
  if (/Vendor\s+Name\s*:/i.test(text) && /PO\s*No\s*:/i.test(text) && /Grand\s+Total/i.test(text)) {
    return hydrateClapstoreVendor(parseMBL(text));
  }
  if (/BLINK\s+COMMERCE/i.test(text) && /Delivered\s*\n?\s*To\s*:/i.test(text)) {
    return hydrateClapstoreVendor(parseBlink(text));
  }
  return hydrateClapstoreVendor(parseGeneric(text));
}
