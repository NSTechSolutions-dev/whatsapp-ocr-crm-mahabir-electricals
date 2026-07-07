import PDFDocument from "pdfkit";
import { env } from "../config/env";

type PdfDoc = InstanceType<typeof PDFDocument>;

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

const BRAND = "#7F1D1D";
const INK = "#2D3748";
const MUTED = "#4A5568";
const LIGHT_MUTED = "#718096";
const ROW_BG = "#F7FAFC";
const WHITE = "#FFFFFF";

const MARGIN_LEFT = 60;
const MARGIN_RIGHT = 60;
const MARGIN_TOP = 50;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN_RIGHT;

function formatUsdDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

function formatInr(amount: number): string {
  return `₹${amount.toFixed(2)}`;
}

function drawLightningLogo(doc: PdfDoc, x: number, y: number, size = 48) {
  const scale = size / 24;
  doc.save();
  doc.translate(x, y);
  doc.scale(scale);
  doc.fillColor(BRAND).path("M 13 2 L 3 14 H 12 L 11 22 L 21 10 H 12 L 13 2 Z").fill();
  doc.restore();
}

function drawDivider(doc: PdfDoc, y: number) {
  doc
    .moveTo(MARGIN_LEFT, y)
    .lineTo(CONTENT_RIGHT, y)
    .lineWidth(3)
    .strokeColor(BRAND)
    .stroke();
}

function drawTableHeader(doc: PdfDoc, y: number, colWidths: number[]) {
  const headers = ["Description", "Quantity", "Price", "Total"];
  const aligns: Array<"left" | "center" | "right"> = ["left", "center", "right", "right"];
  let x = MARGIN_LEFT;

  doc.rect(MARGIN_LEFT, y, CONTENT_WIDTH, 24).fill(BRAND);

  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(10);
  for (let i = 0; i < headers.length; i += 1) {
    const padding = 8;
    const width = colWidths[i];
    const textX = aligns[i] === "left" ? x + padding : x;
    doc.text(headers[i], textX, y + 7, {
      width: aligns[i] === "left" ? width - padding * 2 : width,
      align: aligns[i],
    });
    x += width;
  }
}

function drawTableRow(
  doc: PdfDoc,
  y: number,
  colWidths: number[],
  values: string[],
  aligns: Array<"left" | "center" | "right">
) {
  const rowHeight = 28;
  doc.rect(MARGIN_LEFT, y, CONTENT_WIDTH, rowHeight).fill(ROW_BG);

  doc.fillColor(MUTED).font("Helvetica").fontSize(10);
  let x = MARGIN_LEFT;
  for (let i = 0; i < values.length; i += 1) {
    const padding = 8;
    const width = colWidths[i];
    const textX = aligns[i] === "left" ? x + padding : x;
    doc.text(values[i], textX, y + 9, {
      width: aligns[i] === "left" ? width - padding * 2 : width,
      align: aligns[i],
    });
    x += width;
  }

  return rowHeight;
}

export function buildQuotationPdfBuffer(input: QuotationPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN_TOP, bottom: MARGIN_TOP, left: MARGIN_LEFT, right: MARGIN_RIGHT },
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const now = new Date();
    const validUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const colWidths = [
      CONTENT_WIDTH * 0.5,
      CONTENT_WIDTH * 0.15,
      CONTENT_WIDTH * 0.15,
      CONTENT_WIDTH * 0.2,
    ];

    // Header
    drawLightningLogo(doc, MARGIN_LEFT, MARGIN_TOP, 48);
    doc
      .fillColor(BRAND)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(`${env.COMPANY_NAME.toUpperCase()}`, MARGIN_LEFT, MARGIN_TOP + 54, { lineGap: 1 })
      .fontSize(10)
      .text("ELECTRICAL SUPPLIES");

    const contactWidth = 190;
    const contactX = CONTENT_RIGHT - contactWidth;
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(BRAND)
      .text(env.COMPANY_ADDRESS.toUpperCase(), contactX, MARGIN_TOP, { width: contactWidth, align: "right" })
      .text(`PHONE: ${env.COMPANY_PHONE}`, contactX, doc.y, { width: contactWidth, align: "right" })
      .text(`GSTIN: ${env.COMPANY_GSTIN}`, contactX, doc.y, { width: contactWidth, align: "right" });

    // Title
    let y = MARGIN_TOP + 108;
    doc
      .fillColor(BRAND)
      .font("Helvetica-Bold")
      .fontSize(28)
      .text("QUOTATION", MARGIN_LEFT, y, { width: CONTENT_WIDTH, align: "center", characterSpacing: 2 });

    // Info grid
    y = doc.y + 24;
    const leftColWidth = CONTENT_WIDTH * 0.58;
    const rightColX = MARGIN_LEFT + leftColWidth + 24;
    const labelWidth = 88;
    const infoStartY = y;

    doc.fillColor(INK).font("Helvetica").fontSize(10);
    const infoLines: Array<[string, string]> = [
      ["Quotation No:", `#${input.quotationNumber}`],
      ["Date:", formatUsdDate(now)],
      ["Valid Until:", formatUsdDate(validUntil)],
      ["Customer ID:", input.customer.id.slice(0, 8).toUpperCase()],
    ];

    for (const [label, value] of infoLines) {
      doc.font("Helvetica-Bold").text(label, MARGIN_LEFT, y, { width: labelWidth, continued: false });
      doc.font("Helvetica").text(value, MARGIN_LEFT + labelWidth, y);
      y += 16;
    }

    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text((input.customer.name || "Customer").toUpperCase(), rightColX, infoStartY, {
        width: CONTENT_WIDTH - leftColWidth - 24,
      });
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(MUTED)
      .text(input.customer.company || "—", rightColX, doc.y + 2)
      .text(input.customer.phone || "—", rightColX, doc.y + 2);

    y = Math.max(y, doc.y) + 10;
    drawDivider(doc, y);
    y += 18;

    // Project description
    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(10)
      .text("PROJECT DESCRIPTION", MARGIN_LEFT, y, { width: 130, continued: true })
      .font("Helvetica")
      .fillColor(MUTED)
      .text(
        "Add a brief and concise description of the project, item, or service here.",
        { width: CONTENT_WIDTH - 140 }
      );

    y = doc.y + 18;
    drawTableHeader(doc, y, colWidths);
    y += 24;

    for (const item of input.items) {
      if (y > PAGE_HEIGHT - 220) {
        doc.addPage();
        y = MARGIN_TOP;
      }

      const lineTotal = item.qty * (item.rate || 0);
      const rowHeight = drawTableRow(
        doc,
        y,
        colWidths,
        [
          item.productName,
          `${item.qty} ${item.unit || "pcs"}`,
          formatInr(item.rate || 0),
          formatInr(lineTotal),
        ],
        ["left", "center", "right", "right"]
      );
      y += rowHeight + 2;
    }

    // Totals
    y += 8;
    const totalsWidth = 230;
    const totalsX = CONTENT_RIGHT - totalsWidth;
    const totalsRows: Array<{ label: string; value: string; grand?: boolean }> = [
      { label: "Subtotal", value: formatInr(input.subtotal) },
      { label: `Value-Added Tax (${input.gstPercent}%)`, value: formatInr(input.gstAmount) },
      { label: "Others", value: formatInr(0) },
    ];

    doc.font("Helvetica").fontSize(10).fillColor(MUTED);
    for (const row of totalsRows) {
      doc.text(row.label, totalsX, y, { width: totalsWidth * 0.62, align: "left" });
      doc.text(row.value, totalsX, y, { width: totalsWidth, align: "right" });
      y += 18;
    }

    y += 4;
    doc.rect(totalsX, y, totalsWidth, 26).fill(BRAND);
    doc
      .fillColor(WHITE)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("Total", totalsX + 10, y + 8, { width: totalsWidth * 0.5, align: "left" });
    doc.text(formatInr(input.grandTotal), totalsX, y + 8, { width: totalsWidth - 10, align: "right" });

    y += 44;

    // Terms
    if (y > PAGE_HEIGHT - 150) {
      doc.addPage();
      y = MARGIN_TOP;
    }

    doc
      .moveTo(MARGIN_LEFT, y)
      .lineTo(CONTENT_RIGHT, y)
      .lineWidth(2)
      .strokeColor(BRAND)
      .stroke();
    y += 14;

    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(10)
      .text("TERMS & CONDITIONS", MARGIN_LEFT, y);
    y = doc.y + 4;
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(LIGHT_MUTED)
      .text(
        "Above information is not an invoice and only an estimate of goods/services. Payment will be due prior to provision or delivery of goods/services.",
        MARGIN_LEFT,
        y,
        { width: CONTENT_WIDTH, lineGap: 2 }
      );

    y = doc.y + 28;
    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(10)
      .text("PLEASE CONFIRM YOUR ACCEPTANCE OF THIS QUOTE", MARGIN_LEFT, y, {
        width: CONTENT_WIDTH,
        align: "center",
      });

    y = doc.y + 36;
    const sigWidth = 180;
    const sigY = y;
    const leftSigX = MARGIN_LEFT + 40;
    const rightSigX = CONTENT_RIGHT - sigWidth - 40;

    doc
      .moveTo(leftSigX, sigY)
      .lineTo(leftSigX + sigWidth, sigY)
      .strokeColor(LIGHT_MUTED)
      .lineWidth(1)
      .stroke();
    doc
      .fillColor(LIGHT_MUTED)
      .font("Helvetica")
      .fontSize(9)
      .text("Signature over printed name", leftSigX, sigY + 6, { width: sigWidth, align: "center" });

    doc
      .moveTo(rightSigX, sigY)
      .lineTo(rightSigX + sigWidth, sigY)
      .strokeColor(LIGHT_MUTED)
      .lineWidth(1)
      .stroke();
    doc.text("Date signed", rightSigX, sigY + 6, { width: sigWidth, align: "center" });

    doc.end();
  });
}
