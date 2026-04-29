"use client";

import { useState } from "react";
import type { ExtractedPO, Invoice, LineItem } from "@/lib/types";

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

export default function Page() {
  const [stage, setStage] = useState<"upload" | "loading" | "edit">("upload");
  const [error, setError] = useState<string | null>(null);
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
      setInvoice({
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
      });
      setStage("edit");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStage("upload");
    }
  }

  async function downloadInvoice() {
    setError(null);
    const res = await fetch("/api/invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invoice),
    });
    if (!res.ok) {
      const txt = await res.text();
      let msg = `PDF generation failed (${res.status}): `;
      try {
        const j = JSON.parse(txt);
        msg += j.error || txt.slice(0, 300);
      } catch {
        msg += txt.slice(0, 300);
      }
      setError(msg);
      console.error("Invoice POST failed:", txt);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-${invoice.invoiceNumber || "draft"}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
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
        next.amount = (Number(next.quantity) || 0) * (Number(next.rate) || 0);
        return next;
      });
      const { taxableValue, total } = recalcTotals(items, inv.igstAmount, inv.cgstAmount, inv.sgstAmount, inv.cessAmount, inv.roundOff);
      return { ...inv, items, taxableValue, total };
    });
  }

  function addItem() {
    setInvoice((inv) => ({
      ...inv,
      items: [...inv.items, { description: "", quantity: 1, rate: 0, amount: 0 }],
    }));
  }

  function removeItem(idx: number) {
    setInvoice((inv) => {
      const items = inv.items.filter((_, i) => i !== idx);
      const { taxableValue, total } = recalcTotals(items, inv.igstAmount, inv.cgstAmount, inv.sgstAmount, inv.cessAmount, inv.roundOff);
      return { ...inv, items, taxableValue, total };
    });
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
            <h2 className="card-title">Totals</h2>
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
