import type { Invoice, Party } from "./types";
import { inr, rupeesInWords, taxAmountInWords } from "./format";

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getDate()).padStart(2, "0")}-${months[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
}

function esc(s: string | undefined | null): string {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function partyBlock(p: Party | undefined | null, label?: string): string {
  if (!p) return "";
  const addr = esc(p.address || "").replace(/\n/g, "<br/>");
  return `
    ${label ? `<div class="party-label">${esc(label)}</div>` : ""}
    <div class="party-name">${esc(p.name || "")}</div>
    <div class="party-addr">${addr}</div>
    ${p.gstin ? `<div class="party-line">GSTIN/UIN&nbsp;: ${esc(p.gstin)}</div>` : ""}
    ${p.stateName || p.stateCode ? `<div class="party-line">State Name&nbsp;: ${esc(p.stateName || "")}${p.stateCode ? `, Code : ${esc(p.stateCode)}` : ""}</div>` : ""}
  `;
}

export function buildInvoiceHtml(inv: Invoice): string {
  const isInter = (inv.igstRate || 0) > 0 || (inv.igstAmount || 0) > 0;

  const items = inv.items || [];
  const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  const unit = items[0]?.unit || "Pcs";

  // Summary rows inside the items table (rate goes in the Rate column, "%" in per)
  const summaryRows: Array<{ label: string; rate?: string; amount: number }> = [];
  if (isInter) {
    summaryRows.push({ label: `IGST @${inv.igstRate || 0}%`, rate: `${inv.igstRate || 0}`, amount: inv.igstAmount || 0 });
  } else {
    if ((inv.cgstRate || 0) > 0 || (inv.cgstAmount || 0) > 0) {
      summaryRows.push({ label: `CGST @${inv.cgstRate || 0}%`, rate: `${inv.cgstRate || 0}`, amount: inv.cgstAmount || 0 });
      summaryRows.push({ label: `SGST @${inv.sgstRate || 0}%`, rate: `${inv.sgstRate || 0}`, amount: inv.sgstAmount || 0 });
    }
  }
  if ((inv.cessRate || 0) > 0 || (inv.cessAmount || 0) > 0) {
    summaryRows.push({ label: `CESS @${inv.cessRate || 0}%`, rate: `${inv.cessRate || 0}`, amount: inv.cessAmount || 0 });
  }
  if (Math.abs(inv.roundOff || 0) > 0.001) {
    summaryRows.push({ label: "Round Off", amount: inv.roundOff || 0 });
  }

  const totalTax = (inv.igstAmount || 0) + (inv.cgstAmount || 0) + (inv.sgstAmount || 0) + (inv.cessAmount || 0);

  const itemRows = items
    .map(
      (it, i) => `
      <tr class="item-row">
        <td class="c-sl">${i + 1}</td>
        <td class="c-desc"><b>${esc(it.description || "")}</b></td>
        <td class="c-hsn">${esc(it.hsnCode || "")}</td>
        <td class="c-qty"><b>${it.quantity || 0} ${esc(unit)}</b></td>
        <td class="c-rate">${inr(it.rate || 0)}</td>
        <td class="c-per">${esc(unit)}</td>
        <td class="c-amt"><b>${inr(it.amount || 0)}</b></td>
      </tr>`,
    )
    .join("");

  const summaryHtml = summaryRows
    .map(
      (row) => `
      <tr class="summary-row">
        <td class="c-sl"></td>
        <td class="c-desc"><i><b>${esc(row.label)}</b></i></td>
        <td class="c-hsn"></td>
        <td class="c-qty"></td>
        <td class="c-rate"><i><b>${esc(row.rate || "")}</b></i></td>
        <td class="c-per"><i><b>${row.rate ? "%" : ""}</b></i></td>
        <td class="c-amt"><i><b>${inr(row.amount)}</b></i></td>
      </tr>`,
    )
    .join("");

  const taxSummaryInter = `
    <table class="tax-summary">
      <thead>
        <tr>
          <th rowspan="2" class="ts-tv">Taxable<br/>Value</th>
          <th colspan="2" class="ts-grp">IGST</th>
          <th rowspan="2" class="ts-tot">Total<br/>Tax Amount</th>
        </tr>
        <tr>
          <th>Rate</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="num">${inr(inv.taxableValue || 0)}</td>
          <td class="num">${inv.igstRate || 0}%</td>
          <td class="num">${inr(inv.igstAmount || 0)}</td>
          <td class="num">${inr(inv.igstAmount || 0)}</td>
        </tr>
        <tr class="ts-total">
          <td class="lbl">Total:</td>
          <td class="num"><b>${inr(inv.taxableValue || 0)}</b></td>
          <td class="num"><b>${inr(inv.igstAmount || 0)}</b></td>
          <td class="num"><b>${inr(inv.igstAmount || 0)}</b></td>
        </tr>
      </tbody>
    </table>
  `;

  const taxSummaryIntra = `
    <table class="tax-summary">
      <thead>
        <tr>
          <th rowspan="2" class="ts-tv">Taxable<br/>Value</th>
          <th colspan="2" class="ts-grp">CGST</th>
          <th colspan="2" class="ts-grp">SGST/UTGST</th>
          <th rowspan="2" class="ts-tot">Total<br/>Tax Amount</th>
        </tr>
        <tr>
          <th>Rate</th>
          <th>Amount</th>
          <th>Rate</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="num">${inr(inv.taxableValue || 0)}</td>
          <td class="num">${inv.cgstRate || 0}%</td>
          <td class="num">${inr(inv.cgstAmount || 0)}</td>
          <td class="num">${inv.sgstRate || 0}%</td>
          <td class="num">${inr(inv.sgstAmount || 0)}</td>
          <td class="num">${inr((inv.cgstAmount || 0) + (inv.sgstAmount || 0))}</td>
        </tr>
        <tr class="ts-total">
          <td class="lbl">Total:</td>
          <td></td>
          <td class="num"><b>${inr(inv.cgstAmount || 0)}</b></td>
          <td></td>
          <td class="num"><b>${inr(inv.sgstAmount || 0)}</b></td>
          <td class="num"><b>${inr((inv.cgstAmount || 0) + (inv.sgstAmount || 0))}</b></td>
        </tr>
      </tbody>
    </table>
  `;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Tax Invoice — ${esc(inv.invoiceNumber || "")}</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "DejaVu Sans", Arial, sans-serif;
    color: #000;
    font-size: 9.5pt;
    margin: 0;
    line-height: 1.35;
  }
  .title {
    text-align: center;
    font-weight: 700;
    font-size: 13pt;
    padding: 4px 0 6px 0;
  }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 0.5pt solid #000; padding: 3px 5px; vertical-align: top; }

  /* ===== Header (seller/consignee/buyer + meta grid) ===== */
  .header { width: 100%; table-layout: fixed; }
  .header .left { width: 48%; padding: 0; }
  .header .right { width: 52%; padding: 0; }
  .party-cell { border-bottom: 0.5pt solid #000; padding: 5px 6px; }
  .party-cell:last-child { border-bottom: 0; }
  .party-label { font-size: 8pt; color: #222; margin-bottom: 2px; }
  .party-name { font-weight: 700; font-size: 10pt; }
  .party-addr { font-size: 9pt; margin-top: 2px; }
  .party-line { font-size: 9pt; margin-top: 2px; }

  .meta { width: 100%; table-layout: fixed; }
  .meta td { padding: 3px 6px; height: 36px; }
  .meta .mlabel { font-size: 7.5pt; color: #222; }
  .meta .mval { font-weight: 700; font-size: 9.5pt; display: block; margin-top: 2px; }

  /* ===== Items table with strict column widths ===== */
  .items { table-layout: fixed; }
  .items th {
    background: #fff;
    font-weight: 700;
    font-size: 8.5pt;
    text-align: center;
    padding: 6px 4px;
  }
  .items td { font-size: 9pt; padding: 4px 5px; }
  .items .c-sl   { width: 30px;  text-align: center; }
  .items .c-desc { width: auto;  text-align: left; }
  .items .c-hsn  { width: 70px;  text-align: center; }
  .items .c-qty  { width: 80px;  text-align: right; }
  .items .c-rate { width: 70px;  text-align: right; }
  .items .c-per  { width: 50px;  text-align: center; }
  .items .c-amt  { width: 95px;  text-align: right; }

  /* Tax/summary rows sit inside the items table, no top/bottom borders so the
     vertical column dividers run continuously down the page (Tally look). */
  .summary-row td  { border-top: 0; border-bottom: 0; padding: 2px 5px; }
  .subtotal-row td { border-top: 0; border-bottom: 0; padding: 2px 5px; text-align: right; }
  .spacer-row td   { border-top: 0; border-bottom: 0; height: 150px; }

  /* Total row at the bottom */
  .total-row td {
    border-top: 0.5pt solid #000;
    font-weight: 700;
    font-size: 10pt;
    padding: 5px;
  }
  .total-row .c-amt { font-size: 11pt; }

  /* ===== Below-table blocks ===== */
  .amt-words {
    border: 0.5pt solid #000;
    border-top: 0;
    padding: 5px 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 9pt;
  }
  .amt-words .lbl { color: #222; }
  .amt-words .val { font-weight: 700; font-size: 10pt; }
  .amt-words .eoe { font-style: italic; font-size: 8.5pt; }
  .amt-words-line { font-weight: 700; padding: 4px 6px; border: 0.5pt solid #000; border-top: 0; font-size: 10pt; }

  .tax-summary { border-top: 0; }
  .tax-summary th { background: #fff; font-weight: 600; font-size: 8.5pt; text-align: center; padding: 4px; }
  .tax-summary .ts-grp { font-weight: 700; }
  .tax-summary td { font-size: 9pt; padding: 3px 5px; }
  .tax-summary .num { text-align: right; }
  .tax-summary .lbl { text-align: right; font-weight: 700; }
  .tax-summary .ts-total td { font-weight: 700; }

  .tax-words { padding: 5px 6px 90px 6px; border: 0.5pt solid #000; border-top: 0; font-size: 9pt; }
  .tax-words b { font-size: 10pt; }

  .decl {
    border: 0.5pt solid #000;
    border-top: 0;
    display: table;
    width: 100%;
    table-layout: fixed;
  }
  .decl > div { display: table-cell; padding: 6px 8px; vertical-align: top; }
  .decl .left { width: 60%; border-right: 0.5pt solid #000; font-size: 9pt; }
  .decl .right { width: 40%; text-align: right; font-size: 9pt; }
  .decl .label { font-size: 8.5pt; color: #222; margin-bottom: 18px; }
  .decl .sig { margin-top: 50px; font-weight: 700; }

  .footer { text-align: center; font-size: 9pt; padding: 6px 0 0 0; }
</style>
</head>
<body>

  <div class="title">Tax Invoice</div>

  <!-- ===== HEADER ===== -->
  <table class="header">
    <tr>
      <td class="left">
        <div class="party-cell">${partyBlock(inv.vendor)}</div>
        <div class="party-cell">${partyBlock(inv.shipTo, "Consignee (Ship to)")}</div>
        <div class="party-cell">${partyBlock(inv.buyer, "Buyer (Bill to)")}</div>
      </td>
      <td class="right" style="padding:0;">
        <table class="meta">
          <tr>
            <td><span class="mlabel">Invoice No.</span><span class="mval">${esc(inv.invoiceNumber || "")}</span></td>
            <td><span class="mlabel">Dated</span><span class="mval">${esc(fmtDate(inv.invoiceDate || ""))}</span></td>
          </tr>
          <tr>
            <td><span class="mlabel">Delivery Note</span><span class="mval">${esc(inv.deliveryNoteNo || "")}</span></td>
            <td><span class="mlabel">Mode/Terms of Payment</span><span class="mval">${esc(inv.modeOfPayment || "")}</span></td>
          </tr>
          <tr>
            <td><span class="mlabel">Reference No. &amp; Date.</span><span class="mval">${esc((inv.reference || "") + (inv.referenceDate ? " dt. " + fmtDate(inv.referenceDate) : ""))}</span></td>
            <td><span class="mlabel">Other References</span><span class="mval">${esc(inv.otherReferences || "")}</span></td>
          </tr>
          <tr>
            <td><span class="mlabel">Buyer's Order No.</span><span class="mval">${esc(inv.buyersOrderNo || "")}</span></td>
            <td><span class="mlabel">Dated</span><span class="mval">${esc(fmtDate(inv.buyersOrderDate || ""))}</span></td>
          </tr>
          <tr>
            <td><span class="mlabel">Dispatch Doc No.</span><span class="mval">${esc(inv.dispatchDocNo || "")}</span></td>
            <td><span class="mlabel">Delivery Note Date</span><span class="mval">${esc(fmtDate(inv.deliveryNoteDate || ""))}</span></td>
          </tr>
          <tr>
            <td><span class="mlabel">Dispatched through</span><span class="mval">${esc(inv.dispatchedThrough || "")}</span></td>
            <td><span class="mlabel">Destination</span><span class="mval">${esc(inv.destination || "")}</span></td>
          </tr>
          <tr>
            <td colspan="2" style="height:60px;"><span class="mlabel">Terms of Delivery</span><span class="mval" style="font-weight:400;">${esc(inv.termsOfDelivery || "")}</span></td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- ===== ITEMS TABLE ===== -->
  <table class="items">
    <thead>
      <tr>
        <th class="c-sl">Sl<br/>No.</th>
        <th class="c-desc">Description of Goods</th>
        <th class="c-hsn">HSN/SAC</th>
        <th class="c-qty">Quantity</th>
        <th class="c-rate">Rate</th>
        <th class="c-per">per</th>
        <th class="c-amt">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
      <tr class="subtotal-row">
        <td class="c-sl"></td>
        <td class="c-desc"></td>
        <td class="c-hsn"></td>
        <td class="c-qty"></td>
        <td class="c-rate"></td>
        <td class="c-per"></td>
        <td class="c-amt">${inr(inv.taxableValue || 0)}</td>
      </tr>
      ${summaryHtml}
      <tr class="spacer-row">
        <td class="c-sl"></td>
        <td class="c-desc"></td>
        <td class="c-hsn"></td>
        <td class="c-qty"></td>
        <td class="c-rate"></td>
        <td class="c-per"></td>
        <td class="c-amt"></td>
      </tr>
      <tr class="total-row">
        <td class="c-sl"></td>
        <td class="c-desc">Total</td>
        <td class="c-hsn"></td>
        <td class="c-qty">${totalQty} ${esc(unit)}</td>
        <td class="c-rate"></td>
        <td class="c-per"></td>
        <td class="c-amt">₹ ${inr(inv.total || 0)}</td>
      </tr>
    </tbody>
  </table>

  <!-- ===== AMOUNT IN WORDS ===== -->
  <div class="amt-words">
    <span class="lbl">Amount Chargeable (in words)</span>
    <span class="eoe">E. &amp; O.E</span>
  </div>
  <div class="amt-words-line">${esc(rupeesInWords(inv.total || 0))}</div>

  <!-- ===== TAX SUMMARY ===== -->
  ${isInter ? taxSummaryInter : taxSummaryIntra}

  <div class="tax-words">
    Tax Amount (in words) : <b>${esc(taxAmountInWords(totalTax))}</b>
  </div>

  <!-- ===== DECLARATION ===== -->
  <div class="decl">
    <div class="left">
      <div class="label">Declaration</div>
      We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.
    </div>
    <div class="right">
      <div class="sig">for ${esc(inv.vendor?.name || "")}</div>
      <div style="margin-top: 40px; font-size: 8.5pt;">Authorised Signatory</div>
    </div>
  </div>

  <div class="footer">This is a Computer Generated Invoice</div>

</body>
</html>`;
}
