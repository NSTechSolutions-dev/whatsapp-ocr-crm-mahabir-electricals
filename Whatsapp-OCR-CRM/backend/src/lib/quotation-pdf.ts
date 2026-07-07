import PDFDocument from "pdfkit";
import { env } from "../config/env";

export interface QuotationPdfItem {
  productName: string;
  qty: number;
  unit?: string | null;
  rate?: number | null;
}

export interface QuotationPdfInput {
  quotationNumber: string;
  customer: {
    id: string;
    name?: string | null;
    phone?: string | null;
    company?: string | null;
  };
  items: QuotationPdfItem[];
  subtotal: number;
  gstPercent: number;
  gstAmount: number;
  grandTotal: number;
}

function formatInr(amount: number): string {
  return `Rs ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildQuotationPdfBuffer(input: QuotationPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const brand = "#7F1D1D";
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const rightX = doc.page.margins.left + pageWidth - 180;

    doc.fillColor(brand).font("Helvetica-Bold").fontSize(13).text(env.COMPANY_NAME.toUpperCase());
    doc.fontSize(10).text("ELECTRICAL SUPPLIES");

    doc.fillColor(brand).font("Helvetica").fontSize(9);
    doc.text(env.COMPANY_ADDRESS.toUpperCase(), rightX, 50, { width: 180, align: "right" });
    doc.text(`PHONE: ${env.COMPANY_PHONE}`, rightX, doc.y, { width: 180, align: "right" });
    doc.text(`GSTIN: ${env.COMPANY_GSTIN}`, rightX, doc.y, { width: 180, align: "right" });

    doc.moveDown(2);
    doc.fillColor(brand).font("Helvetica-Bold").fontSize(22).text("QUOTATION", { align: "center" });
    doc.moveDown(1.2);

    const now = new Date();
    const validUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    doc.fillColor("#2D3748").font("Helvetica").fontSize(10);
    doc.text(`Quotation No: #${input.quotationNumber}`);
    doc.text(`Date: ${now.toLocaleDateString("en-IN")}`);
    doc.text(`Valid Until: ${validUntil.toLocaleDateString("en-IN")}`);
    doc.text(`Customer ID: ${input.customer.id.slice(0, 8).toUpperCase()}`);

    doc.moveDown(0.8);
    doc.font("Helvetica-Bold")
      .text((input.customer.name || "Customer").toUpperCase())
      .font("Helvetica")
      .text(input.customer.company || "—")
      .text(input.customer.phone || "—");

    doc.moveDown(1);
    const tableTop = doc.y;
    const colDesc = doc.page.margins.left;
    const colQty = colDesc + 250;
    const colRate = colQty + 70;
    const colTotal = colRate + 80;

    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Description", colDesc, tableTop);
    doc.text("Qty", colQty, tableTop);
    doc.text("Price", colRate, tableTop);
    doc.text("Total", colTotal, tableTop);
    doc
      .moveTo(colDesc, tableTop + 14)
      .lineTo(doc.page.width - doc.page.margins.right, tableTop + 14)
      .strokeColor("#E2E8F0")
      .stroke();

    let rowY = tableTop + 22;
    doc.font("Helvetica").fontSize(9);

    for (const item of input.items) {
      if (rowY > doc.page.height - 160) {
        doc.addPage();
        rowY = doc.page.margins.top;
      }

      const lineTotal = item.qty * (item.rate || 0);
      doc.text(item.productName, colDesc, rowY, { width: 235 });
      doc.text(`${item.qty} ${item.unit || "pcs"}`, colQty, rowY);
      doc.text(formatInr(item.rate || 0), colRate, rowY);
      doc.text(formatInr(lineTotal), colTotal, rowY);
      rowY += 20;
    }

    const totalsY = Math.max(rowY + 16, doc.page.height - 140);
    const totalsX = doc.page.width - doc.page.margins.right - 170;
    doc.font("Helvetica").fontSize(10);
    doc.text(`Subtotal`, totalsX, totalsY, { width: 90, align: "left" });
    doc.text(formatInr(input.subtotal), totalsX + 95, totalsY, { width: 75, align: "right" });
    doc.text(`GST (${input.gstPercent}%)`, totalsX, totalsY + 16, { width: 90, align: "left" });
    doc.text(formatInr(input.gstAmount), totalsX + 95, totalsY + 16, { width: 75, align: "right" });
    doc.font("Helvetica-Bold");
    doc.text("Grand Total", totalsX, totalsY + 36, { width: 90, align: "left" });
    doc.text(formatInr(input.grandTotal), totalsX + 95, totalsY + 36, { width: 75, align: "right" });

    doc.moveDown(4);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(brand).text("TERMS & CONDITIONS");
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#4A5568")
      .text(
        "Above information is not an invoice and only an estimate of goods/services. Payment will be due prior to provision or delivery of goods/services.",
        { width: pageWidth }
      );

    doc.end();
  });
}
