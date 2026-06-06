"use client";

import { useState } from "react";
import type { ExtractedPO, Invoice, LineItem } from "@/lib/types";
import { buildInvoiceHtml } from "@/lib/invoiceHtml";

const blankPO: ExtractedPO = {
  poNumber: "",
  poDate: "",
  deliveryDate: "",
  paymentTerms: "",
  reference: "",
  referenceDate: "",
  currency: "USD",
  vendor: { name: "", address: "", email: "", phone: "" },
  buyer: { name: "", address: "", email: "", phone: "" },
  shipTo: { name: "", address: "", email: "", phone: "" },
  items: [],
  taxableValue: 0,
  igstRate: 0,
  cgstRate: 0,
  sgstRate: 0,
  cessRate: 0,
  igstAmount: 0,
  cgstAmount: 0,
  sgstAmount: 0,
  cessAmount: 0,
  roundOff: 0,
  total: 0,
  notes: "",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// Is this an inter-state (IGST) invoice vs intra-state (CGST+SGST)?
function isInterState(inv: Invoice): boolean {
  return (inv.igstRate || 0) > 0 || ((inv.igstAmount || 0) > 0 && !(inv.cgstAmount || 0) && !(inv.sgstAmount || 0));
}

// Fill in % rates from amounts when the parser only gave amounts (generic POs),
// so auto-calculate has rates to work from.
function seedRates(inv: Invoice): Invoice {
  const tv = inv.taxableValue || 0;
  if (tv <= 0) return inv;
  const out = { ...inv };
  if (!out.igstRate && out.igstAmount) out.igstRate = round2((out.igstAmount / tv) * 100);
  if (!out.cgstRate && out.cgstAmount) out.cgstRate = round2((out.cgstAmount / tv) * 100);
  if (!out.sgstRate && out.sgstAmount) out.sgstRate = round2((out.sgstAmount / tv) * 100);
  if (!out.cessRate && out.cessAmount) out.cessRate = round2((out.cessAmount / tv) * 100);
  return out;
}

// Recompute every derived figure from quantities, rates and tax %.
// Grand total is rounded to the nearest rupee and the gap booked to Round Off.
function recompute(inv: Invoice): Invoice {
  const items = inv.items.map((it) => ({
    ...it,
    amount: round2((Number(it.quantity) || 0) * (Number(it.rate) || 0)),
  }));
  const taxableValue = round2(items.reduce((s, i) => s + i.amount, 0));

  let igstAmount = 0;
  let cgstAmount = 0;
  let sgstAmount = 0;
  if (isInterState(inv)) {
    igstAmount = round2(taxableValue * ((inv.igstRate || 0) / 100));
  } else {
    cgstAmount = round2(taxableValue * ((inv.cgstRate || 0) / 100));
    sgstAmount = round2(taxableValue * ((inv.sgstRate || 0) / 100));
  }
  const cessAmount = round2(taxableValue * ((inv.cessRate || 0) / 100));

  const preRound = taxableValue + igstAmount + cgstAmount + sgstAmount + cessAmount;
  const total = Math.round(preRound);
  const roundOff = round2(total - preRound);

  return { ...inv, items, taxableValue, igstAmount, cgstAmount, sgstAmount, cessAmount, roundOff, total };
}

export default function Page() {
  const [stage, setStage] = useState<"upload" | "loading" | "edit">("upload");
  const [error, setError] = useState<string | null>(null);
  const [autoCalc, setAutoCalc] = useState(true);
  const [invoice, setInvoice] = useState<Invoice>({
    ...blankPO,
    invoiceNumber: "",
    invoiceDate: todayISO(),
    buyersOrderNo: "",
    buyersOrderDate: "",
    dispatchDocNo: "",
    dispatchedThrough: "",
    destination: "",
    termsOfDelivery: "",
    modeOfPayment: "",
    deliveryNoteNo: "",
    deliveryNoteDate: "",
    otherReferences: "",
  });

  async function handleFile(file: File) {
    setError(null);
    setStage("loading");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      const raw = await res.text();
      let json: { data?: ExtractedPO; error?: string } = {};
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error(`Server returned non-JSON (${res.status}): ${raw.slice(0, 200)}`);
      }
      if (!res.ok) throw new Error(json.error || "Extraction failed");
      const po = json.data as ExtractedPO;
      setInvoice(
        seedRates({
          ...blankPO,
          ...po,
          invoiceNumber: po.poNumber ? `INV-${po.poNumber}` : `INV-${Date.now().toString().slice(-6)}`,
          invoiceDate: todayISO(),
          buyersOrderNo: po.poNumber || "",
          buyersOrderDate: po.poDate || "",
          dispatchDocNo: "",
          dispatchedThrough: "",
          destination: "",
          termsOfDelivery: po.paymentTerms || "",
          modeOfPayment: "",
          deliveryNoteNo: "",
          deliveryNoteDate: "",
          otherReferences: po.reference || "",
        }),
      );
      setStage("edit");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStage("upload");
    }
  }

  function downloadInvoice() {
    setError(null);
    try {
      const html = buildInvoiceHtml(invoice);
      const docTitle = `invoice-${invoice.invoiceNumber || "draft"}`;
      const headInject = `<title>${docTitle}</title>
<style>
  @media screen {
    body { margin: 0; }
    .print-bar {
      position: sticky; top: 0; z-index: 9999;
      display: flex; gap: 12px; align-items: center; justify-content: center;
      padding: 10px 16px; background: #111; color: #fff;
      font: 14px/1.4 system-ui, sans-serif;
    }
    .print-bar button {
      background: #2563eb; color: #fff; border: 0;
      padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600;
    }
    .print-bar button:hover { background: #1d4ed8; }
    .print-bar span { opacity: 0.85; }
  }
  @media print { .print-bar { display: none !important; } }
</style>
<script>
  function doPrint(){ window.print(); }
  window.addEventListener('load', function(){ setTimeout(doPrint, 500); });
</script>`;
      const bar = `<div class="print-bar">
  <span>Use <b>Save as PDF</b> in the print dialog.</span>
  <button onclick="doPrint()">Open Print / Save as PDF</button>
</div>`;
      let printable = html.replace("</head>", headInject + "</head>");
      printable = printable.replace("<body>", "<body>" + bar);
      const win = window.open("", "_blank");
      if (!win) {
        setError("Popup blocked. Allow popups for this site, then click Generate PDF again.");
        return;
      }
      win.document.open();
      win.document.write(printable);
      win.document.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open invoice");
    }
  }

  function recalcTotals(items: LineItem[], igst: number, cgst: number, sgst: number, cess: number, roundOff: number) {
    const taxableValue = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const total = taxableValue + Number(igst) + Number(cgst) + Number(sgst) + Number(cess) + Number(roundOff);
    return { taxableValue, total };
  }

  function updateItem(idx: number, patch: Partial<LineItem>) {
    setInvoice((inv) => {
      const items = inv.items.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, ...patch };
        next.amount = round2((Number(next.quantity) || 0) * (Number(next.rate) || 0));
        return next;
      });
      const draft = { ...inv, items };
      if (autoCalc) return recompute(draft);
      const { taxableValue, total } = recalcTotals(items, inv.igstAmount, inv.cgstAmount, inv.sgstAmount, inv.cessAmount, inv.roundOff);
      return { ...draft, taxableValue, total };
    });
  }

  function addItem() {
    setInvoice((inv) => {
      const draft = { ...inv, items: [...inv.items, { description: "", quantity: 1, rate: 0, amount: 0 }] };
      return autoCalc ? recompute(draft) : draft;
    });
  }

  function removeItem(idx: number) {
    setInvoice((inv) => {
      const items = inv.items.filter((_, i) => i !== idx);
      const draft = { ...inv, items };
      if (autoCalc) return recompute(draft);
      const { taxableValue, total } = recalcTotals(items, inv.igstAmount, inv.cgstAmount, inv.sgstAmount, inv.cessAmount, inv.roundOff);
      return { ...draft, taxableValue, total };
    });
  }

  // Toggle auto-calc; when turning it on, immediately reconcile all derived figures.
  function toggleAutoCalc(on: boolean) {
    setAutoCalc(on);
    if (on) setInvoice((inv) => recompute(inv));
  }

  // Update a tax % rate and (in auto-calc) recompute amounts/total from it.
  function updateRate(field: "igstRate" | "cgstRate" | "sgstRate", value: number) {
    setInvoice((inv) => recompute({ ...inv, [field]: value }));
  }

  return (
    <main className="container">
      <header className="mb-6 text-center">
        <h1 className="header-title">PO → Invoice</h1>
        <p className="header-subtitle">
          Transform your Purchase Orders into professional Invoices instantly.
        </p>
      </header>

      {error && <div className="error-message">{error}</div>}

      {stage === "upload" && (
        <label className="upload-zone">
          <div className="upload-icon">📄</div>
          <span className="upload-text">Drop your Purchase Order PDF</span>
          <span className="upload-subtext">or click to browse files</span>
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </label>
      )}

      {stage === "loading" && (
        <div className="loader-container">
          <div className="spinner" />
          <p className="upload-text">Analyzing with AI...</p>
          <p className="upload-subtext">Extracting fields from your purchase order</p>
        </div>
      )}

      {stage === "edit" && (
        <div>
          <div className="card">
            <h2 className="card-title">Invoice Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Invoice #" value={invoice.invoiceNumber} onChange={(v) => setInvoice({ ...invoice, invoiceNumber: v })} />
              <Field label="Invoice date" type="date" value={invoice.invoiceDate} onChange={(v) => setInvoice({ ...invoice, invoiceDate: v })} />
              <Field label="Currency" value={invoice.currency} onChange={(v) => setInvoice({ ...invoice, currency: v })} />
              <Field label="PO / Buyer's Order No" value={invoice.buyersOrderNo} onChange={(v) => setInvoice({ ...invoice, buyersOrderNo: v })} />
              <Field label="PO Date" type="date" value={invoice.buyersOrderDate} onChange={(v) => setInvoice({ ...invoice, buyersOrderDate: v })} />
              <Field label="Terms of Delivery" value={invoice.termsOfDelivery} onChange={(v) => setInvoice({ ...invoice, termsOfDelivery: v })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <PartySection title="From (Vendor)" party={invoice.vendor} onChange={(p) => setInvoice({ ...invoice, vendor: p })} />
            <PartySection title="Bill To (Buyer)" party={invoice.buyer} onChange={(p) => setInvoice({ ...invoice, buyer: p })} />
          </div>

          <div className="card">
            <h2 className="card-title">Line Items</h2>
            <div className="line-items-header">
              <div>Description</div>
              <div className="text-right">Qty</div>
              <div className="text-right">Rate</div>
              <div className="text-right">Amount</div>
              <div></div>
            </div>
            {invoice.items.map((it, idx) => (
              <div key={idx} className="line-item-row">
                <input
                  className="form-input"
                  value={it.description}
                  onChange={(e) => updateItem(idx, { description: e.target.value })}
                  placeholder="Item description"
                />
                <input
                  type="number"
                  className="form-input text-right"
                  value={it.quantity}
                  onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                />
                <input
                  type="number"
                  step="0.01"
                  className="form-input text-right"
                  value={it.rate}
                  onChange={(e) => updateItem(idx, { rate: Number(e.target.value) })}
                />
                <input
                  type="number"
                  step="0.01"
                  className="form-input text-right"
                  value={it.amount}
                  readOnly
                />
                <button
                  onClick={() => removeItem(idx)}
                  className="btn btn-danger"
                  aria-label="Remove item"
                  title="Remove item"
                >
                  ✕
                </button>
              </div>
            ))}
            <button onClick={addItem} className="btn btn-ghost mt-4">
              + Add Line Item
            </button>
          </div>

          <div className="card">
            <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
              <h2 className="card-title" style={{ margin: 0 }}>Totals</h2>
              <label className="flex items-center gap-2" style={{ cursor: "pointer", fontSize: 14 }}>
                <input type="checkbox" checked={autoCalc} onChange={(e) => toggleAutoCalc(e.target.checked)} />
                Auto-calculate from Qty × Rate
              </label>
            </div>

            {autoCalc ? (
              <div className="grid grid-cols-2 gap-4">
                <Field label="Taxable Value (Subtotal)" type="number" value={String(invoice.taxableValue)} onChange={() => {}} readOnly />
                {isInterState(invoice) ? (
                  <>
                    <Field label="IGST %" type="number" value={String(invoice.igstRate)} onChange={(v) => updateRate("igstRate", Number(v))} />
                    <Field label="IGST Amount" type="number" value={String(invoice.igstAmount)} onChange={() => {}} readOnly />
                  </>
                ) : (
                  <>
                    <Field label="CGST %" type="number" value={String(invoice.cgstRate)} onChange={(v) => updateRate("cgstRate", Number(v))} />
                    <Field label="SGST %" type="number" value={String(invoice.sgstRate)} onChange={(v) => updateRate("sgstRate", Number(v))} />
                    <Field label="CGST Amount" type="number" value={String(invoice.cgstAmount)} onChange={() => {}} readOnly />
                    <Field label="SGST Amount" type="number" value={String(invoice.sgstAmount)} onChange={() => {}} readOnly />
                  </>
                )}
                <Field label="Round Off (auto)" type="number" value={String(invoice.roundOff)} onChange={() => {}} readOnly />
                <Field label="Total" type="number" value={String(invoice.total)} onChange={() => {}} readOnly />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <Field label="Taxable Value (Subtotal)" type="number" value={String(invoice.taxableValue)} onChange={(v) => setInvoice({ ...invoice, taxableValue: Number(v) })} readOnly />
                <Field
                  label="IGST Amount"
                  type="number"
                  value={String(invoice.igstAmount)}
                  onChange={(v) => {
                    const igst = Number(v);
                    const { total } = recalcTotals(invoice.items, igst, invoice.cgstAmount, invoice.sgstAmount, invoice.cessAmount, invoice.roundOff);
                    setInvoice({ ...invoice, igstAmount: igst, total });
                  }}
                />
                <Field
                  label="CGST Amount"
                  type="number"
                  value={String(invoice.cgstAmount)}
                  onChange={(v) => {
                    const cgst = Number(v);
                    const { total } = recalcTotals(invoice.items, invoice.igstAmount, cgst, invoice.sgstAmount, invoice.cessAmount, invoice.roundOff);
                    setInvoice({ ...invoice, cgstAmount: cgst, total });
                  }}
                />
                <Field
                  label="SGST Amount"
                  type="number"
                  value={String(invoice.sgstAmount)}
                  onChange={(v) => {
                    const sgst = Number(v);
                    const { total } = recalcTotals(invoice.items, invoice.igstAmount, invoice.cgstAmount, sgst, invoice.cessAmount, invoice.roundOff);
                    setInvoice({ ...invoice, sgstAmount: sgst, total });
                  }}
                />
                <Field label="Round Off" type="number" value={String(invoice.roundOff)} onChange={(v) => {
                    const roundOff = Number(v);
                    const { total } = recalcTotals(invoice.items, invoice.igstAmount, invoice.cgstAmount, invoice.sgstAmount, invoice.cessAmount, roundOff);
                    setInvoice({ ...invoice, roundOff, total });
                  }} />
                <Field label="Total" type="number" value={String(invoice.total)} onChange={(v) => setInvoice({ ...invoice, total: Number(v) })} readOnly />
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="card-title">Notes</h2>
            <textarea
              className="form-textarea"
              rows={3}
              value={invoice.notes || ""}
              onChange={(e) => setInvoice({ ...invoice, notes: e.target.value })}
              placeholder="Thank you for your business..."
            />
          </div>

          <div className="flex justify-between items-center mt-4">
            <button
              onClick={() => {
                setStage("upload");
                setError(null);
              }}
              className="btn btn-secondary"
            >
              ← Start Over
            </button>
            <button onClick={downloadInvoice} className="btn btn-primary">
              Generate PDF
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  readOnly?: boolean;
}) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input
        type={type}
        className={`form-input ${type === "number" ? "text-right" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
      />
    </div>
  );
}

function PartySection({
  title,
  party,
  onChange,
}: {
  title: string;
  party: { name: string; address: string; email?: string; phone?: string };
  onChange: (p: { name: string; address: string; email?: string; phone?: string }) => void;
}) {
  return (
    <div className="card">
      <h2 className="card-title">{title}</h2>
      <Field label="Name" value={party.name} onChange={(v) => onChange({ ...party, name: v })} />
      <div className="form-group">
        <label className="form-label">Address</label>
        <textarea
          className="form-textarea"
          rows={3}
          value={party.address}
          onChange={(e) => onChange({ ...party, address: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Email" value={party.email || ""} onChange={(v) => onChange({ ...party, email: v })} />
        <Field label="Phone" value={party.phone || ""} onChange={(v) => onChange({ ...party, phone: v })} />
      </div>
    </div>
  );
}
