# PO → Invoice Converter

Next.js 15 + TypeScript app that takes a buyer's PO PDF and produces a GST-compliant tax invoice PDF for **Clapstore Private Limited** (the seller).

## Run / deploy
- `npm run dev` — local dev (port 3000, falls back to 3001 if busy)
- Deploy via `render.yaml` (Render Blueprint, free tier). Set `BASIC_AUTH_USER`, `BASIC_AUTH_PASS`, and `ANTHROPIC_API_KEY` as Render secret env vars.
- Basic Auth gates everything when both `BASIC_AUTH_USER` + `BASIC_AUTH_PASS` are set (`middleware.ts`). Unset locally for no-prompt dev.

## Architecture
- **Upload → parse:** `app/api/extract/route.ts` runs `pdf-parse` then `parsePOText()` (`lib/parsePO.ts`).
- **Render PDF:** `app/api/invoice/route.ts` builds HTML via `lib/invoiceHtml.ts` and renders with **Puppeteer** (HTML→PDF). Do not switch back to `pdf-lib`.
- **Frontend:** single page (`app/page.tsx`) — upload → editable form → "Generate PDF".

## PO format detection (`parsePOText`)
Auto-routes on text markers:
1. **MBL family** (`Vendor Name:` + `PO No:` + `Grand Total`) → `parseMBL`. Buyers: MOKSH (Karnataka, IGST), Cloudstore (Maharashtra, intra-state CGST+SGST).
2. **Blink Commerce** (`BLINK COMMERCE` + `Delivered To:`) → `parseBlink`. PO numbers are 14-digit (e.g. `49990010016354`). Items table has column-shifted decimals from PDF extraction (e.g. `1999.0\n0`); the parser iterates `(\d)\s*\.\s*(\d)` and `(\d+\.\d)\s+(\d)` repairs until the string is stable.
3. Else → `parseGeneric` (best-effort fallback; doesn't extract addresses or items).

`hydrateClapstoreVendor()` runs after every parse: if the PO names Clapstore (PAN `AALCC5576H` or name match), the vendor side is overwritten with canonical static details from `lib/company.ts`.

## Key invariants
- **Ship-to** in Blink POs comes from the "Delivered To" block; buyer "Bill to" mirrors it (Blink POs don't carry a separate billing address).
- **Inter vs intra-state** is decided by first 2 digits of vendor vs buyer GSTIN. Different → IGST. Same → CGST + SGST (split half/half).
- **Tax rate** is read from item rows, not hardcoded. Falls back to 18% only if items don't parse.
- **Round Off** is computed as `total − taxable − tax` so the invoice grand total exactly matches the PO grand total. Tax itself is computed strictly as `rate% × taxable` — do **not** back-solve tax from `total − taxable` (causes effective rate >18%).

## Debug
Set `PO_DEBUG_DUMP=1` in `.env.local` to dump every parsed PO + raw text to `debug-po.txt` (gitignored). Off in prod.
