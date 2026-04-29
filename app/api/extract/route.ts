import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { writeFile } from "fs/promises";
import { join } from "path";
import { parsePOText } from "@/lib/parsePO";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let parser: PDFParse | null = null;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Only PDF uploads are supported" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    parser = new PDFParse({ data: bytes });
    const result = await parser.getText();
    const data = parsePOText(result.text);
    try {
      const dbgPath = join(process.cwd(), "debug-po.txt");
      const summary = JSON.stringify(
        {
          poNumber: data.poNumber,
          vendorName: data.vendor.name,
          buyerName: data.buyer.name,
          itemCount: data.items.length,
          taxableValue: data.taxableValue,
          total: data.total,
        },
        null,
        2,
      );
      await writeFile(dbgPath, `===== PARSED SUMMARY =====\n${summary}\n\n===== RAW PO TEXT =====\n${result.text}`, "utf8");
      console.log("Wrote debug dump to", dbgPath);
    } catch (e) {
      console.error("Failed to write debug-po.txt:", e);
    }
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Parsing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (parser) {
      try { await parser.destroy(); } catch { /* ignore */ }
    }
  }
}
