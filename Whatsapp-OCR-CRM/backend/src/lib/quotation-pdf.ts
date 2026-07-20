import PDFDocument from "pdfkit";
import { env } from "../config/env";
import { displayUnitRate, type GstMode } from "../utils/gst-calculation";

type PdfDoc = InstanceType<typeof PDFDocument>;

export interface QuotationPdfItem {
  productName: string;
  qty: number;
  unit?: string | null;
  rate?: number | null;
}

export interface QuotationPdfBankDetails {
  bankName?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
  ifsc?: string | null;
  branch?: string | null;
  upiId?: string | null;
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
  deliveryCharge?: number;
  gstPercent: number;
  gstMode?: GstMode;
  gstAmount: number;
  roundOff?: number;
  grandTotal: number;
  bank?: QuotationPdfBankDetails | null;
  qrImage?: Buffer | null;
  companyProfile?: {
    name?: string | null;
    address?: string | null;
    phone?: string | null;
    gstin?: string | null;
  } | null;
  brandLogos?: Buffer[];
}

const BRAND = "#7F1D1D";
const INK = "#2D3748";
const MUTED = "#4A5568";
const LIGHT_MUTED = "#718096";
const ROW_BG = "#F7FAFC";
const WHITE = "#FFFFFF";

const MARGIN_LEFT = 48;
const MARGIN_RIGHT = 48;
const MARGIN_TOP = 32;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN_RIGHT;

const CELL_PAD_LEFT = 8;
const CELL_PAD_RIGHT = 10;

function formatDateDdMmYyyy(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatInr(amount: number): string {
  return `Rs ${amount.toFixed(2)}`;
}

function orFallback(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function hasBankDetails(bank?: QuotationPdfBankDetails | null): boolean {
  if (!bank) return false;
  return Boolean(
    bank.bankName ||
      bank.accountName ||
      bank.accountNumber ||
      bank.ifsc ||
      bank.branch ||
      bank.upiId
  );
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

function cellTextWidth(colWidth: number, align: "left" | "center" | "right"): number {
  if (align === "left") return colWidth - CELL_PAD_LEFT * 2;
  if (align === "right") return colWidth - CELL_PAD_RIGHT;
  return colWidth;
}

function drawTableHeader(doc: PdfDoc, y: number, colWidths: number[]) {
  const headers = ["Description", "Quantity", "Price", "Total"];
  const aligns: Array<"left" | "center" | "right"> = ["left", "center", "right", "right"];
  let x = MARGIN_LEFT;

  doc.rect(MARGIN_LEFT, y, CONTENT_WIDTH, 20).fill(BRAND);

  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(9);
  for (let i = 0; i < headers.length; i += 1) {
    const width = colWidths[i];
    const align = aligns[i];
    const textX = align === "left" ? x + CELL_PAD_LEFT : x;
    doc.text(headers[i], textX, y + 5, {
      width: cellTextWidth(width, align),
      align,
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
  const rowHeight = 22;
  doc.rect(MARGIN_LEFT, y, CONTENT_WIDTH, rowHeight).fill(ROW_BG);

  doc.fillColor(MUTED).font("Helvetica").fontSize(9);
  let x = MARGIN_LEFT;
  for (let i = 0; i < values.length; i += 1) {
    const width = colWidths[i];
    const align = aligns[i];
    const textX = align === "left" ? x + CELL_PAD_LEFT : x;
    doc.text(values[i], textX, y + 6, {
      width: cellTextWidth(width, align),
      align,
      lineBreak: false,
    });
    x += width;
  }

  return rowHeight;
}

function drawBankAndQr(
  doc: PdfDoc,
  y: number,
  input: QuotationPdfInput,
  contentBottom: number = PAGE_HEIGHT - MARGIN_TOP
): number {
  const bank = input.bank;
  const showBank = hasBankDetails(bank);
  const showQr = Boolean(input.qrImage);

  if (!showBank && !showQr) {
    return y;
  }

  if (y > contentBottom - 200) {
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

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text("PAYMENT DETAILS", MARGIN_LEFT, y);
  const contentStartY = doc.y + 10;

  const qrSize = 130;
  const qrX = CONTENT_RIGHT - qrSize;
  const bankLabelWidth = 88;
  const bankTextWidth = showQr ? CONTENT_WIDTH - qrSize - 24 : CONTENT_WIDTH;

  let bankBottomY = contentStartY;

  if (showBank && bank) {
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    const lines: Array<[string, string]> = [];
    if (bank.bankName) lines.push(["Bank:", bank.bankName]);
    if (bank.accountName) lines.push(["Account Name:", bank.accountName]);
    if (bank.accountNumber) lines.push(["Account No:", bank.accountNumber]);
    if (bank.ifsc) lines.push(["IFSC:", bank.ifsc]);
    if (bank.branch) lines.push(["Branch:", bank.branch]);
    if (bank.upiId) lines.push(["UPI ID:", bank.upiId]);

    let lineY = contentStartY;
    for (const [label, value] of lines) {
      doc.font("Helvetica-Bold").text(label, MARGIN_LEFT, lineY, {
        width: bankLabelWidth,
        lineBreak: false,
      });
      doc.font("Helvetica").text(value, MARGIN_LEFT + bankLabelWidth, lineY, {
        width: bankTextWidth - bankLabelWidth,
        lineBreak: false,
        ellipsis: true,
      });
      lineY += 14;
    }
    bankBottomY = lineY;
  }

  let qrBottomY = contentStartY;
  if (showQr && input.qrImage) {
    try {
      doc.image(input.qrImage, qrX, contentStartY, { fit: [qrSize, qrSize] });
      doc
        .fillColor(LIGHT_MUTED)
        .font("Helvetica")
        .fontSize(8)
        .text("Scan to pay", qrX, contentStartY + qrSize + 4, { width: qrSize, align: "center" });
      qrBottomY = contentStartY + qrSize + 18;
    } catch {
      // Skip QR if image cannot be embedded
    }
  }

  return Math.max(bankBottomY, qrBottomY) + 8;
}

/**
 * Draws title first, then company block. Returns Y below the company header.
 */
function drawHeader(
  doc: PdfDoc,
  companyProfile?: {
    name?: string | null;
    address?: string | null;
    phone?: string | null;
    gstin?: string | null;
  } | null
): number {
  const companyName = orFallback(companyProfile?.name, env.COMPANY_NAME);
  const companyAddress = orFallback(companyProfile?.address, env.COMPANY_ADDRESS);
  const companyPhone = orFallback(companyProfile?.phone, env.COMPANY_PHONE);
  const companyGstin = orFallback(companyProfile?.gstin, env.COMPANY_GSTIN);

  // 1. Title at top
  doc
    .fillColor(BRAND)
    .font("Helvetica-Bold")
    .fontSize(20)
    .text("QUOTATION", MARGIN_LEFT, MARGIN_TOP, {
      width: CONTENT_WIDTH,
      align: "center",
      characterSpacing: 1.5,
    });

  let y = doc.y + 8;

  // 2. Company details below title
  const logoSize = 36;
  const contactWidth = 280;
  const contactX = CONTENT_RIGHT - contactWidth;
  const identityX = MARGIN_LEFT + logoSize + 10;

  drawLightningLogo(doc, MARGIN_LEFT, y, logoSize);

  doc
    .fillColor(BRAND)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(companyName.toUpperCase(), identityX, y, {
      width: contactX - identityX - 8,
      lineGap: 0,
    });

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(MUTED)
    .text(companyAddress, identityX, doc.y + 1, {
      width: contactX - identityX - 8,
      lineGap: 1,
    });

  const companyBlockBottom = Math.max(y + logoSize, doc.y);

  doc
    .fillColor(BRAND)
    .font("Helvetica")
    .fontSize(8)
    .text(`Phone: ${companyPhone}`, contactX, y, {
      width: contactWidth,
      align: "right",
      lineGap: 1,
    });
  doc.text(`GSTIN: ${companyGstin}`, contactX, doc.y + 1, {
    width: contactWidth,
    align: "right",
  });

  return Math.max(companyBlockBottom, doc.y) + 8;
}

const BRAND_LOGO_HEIGHT = 32;
const BRAND_LOGO_MAX_WIDTH = 80;
const BRAND_LOGO_GAP_X = 10;
const BRAND_LOGO_GAP_Y = 6;
const BRAND_LOGO_FOOTER_PAD_TOP = 8;
/** Space under logos reserved for "Page X of Y" (must fit on the same page). */
const BRAND_LOGO_FOOTER_PAD_BOTTOM = 18;
const PAGE_NUMBER_GAP = 4;
const PAGE_NUMBER_FONT_SIZE = 8;

/**
 * PdfKit auto-paginates anything drawn past page.margins.bottom.
 * Footer + page numbers sit in that reserved band, so margins must be
 * cleared for the whole footer paint — otherwise each page number becomes
 * its own blank page (e.g. 3 content pages → 6).
 */
function withFooterDrawSafe(doc: PdfDoc, draw: () => void): void {
  const margins = doc.page.margins;
  const prev = {
    top: margins.top,
    bottom: margins.bottom,
    left: margins.left,
    right: margins.right,
  };
  margins.top = 0;
  margins.bottom = 0;
  margins.left = 0;
  margins.right = 0;
  try {
    draw();
  } finally {
    margins.top = prev.top;
    margins.bottom = prev.bottom;
    margins.left = prev.left;
    margins.right = prev.right;
  }
}

function brandLogosPerRow(): number {
  const slot = BRAND_LOGO_MAX_WIDTH + BRAND_LOGO_GAP_X;
  return Math.max(1, Math.floor((CONTENT_WIDTH + BRAND_LOGO_GAP_X) / slot));
}

function measureBrandLogoFooterHeight(logoCount: number): number {
  if (logoCount <= 0) return BRAND_LOGO_FOOTER_PAD_BOTTOM;
  const perRow = brandLogosPerRow();
  const rows = Math.ceil(logoCount / perRow);
  return (
    BRAND_LOGO_FOOTER_PAD_TOP +
    rows * BRAND_LOGO_HEIGHT +
    (rows - 1) * BRAND_LOGO_GAP_Y +
    BRAND_LOGO_FOOTER_PAD_BOTTOM
  );
}

/** Draw brand logos + optional page number under them, without creating new pages. */
function drawFooterAndPageNumber(
  doc: PdfDoc,
  logos: Buffer[],
  page: number,
  totalPages: number
): void {
  const footerHeight = measureBrandLogoFooterHeight(logos.length);
  const maxPageNumberY = PAGE_HEIGHT - PAGE_NUMBER_FONT_SIZE - 4;

  withFooterDrawSafe(doc, () => {
    let pageNumberY = PAGE_HEIGHT - 14;

    if (logos.length) {
      const perRow = brandLogosPerRow();
      const logoWidth = Math.min(BRAND_LOGO_MAX_WIDTH, CONTENT_WIDTH);
      let y = PAGE_HEIGHT - footerHeight + BRAND_LOGO_FOOTER_PAD_TOP;
      let logosBottom = y;

      doc
        .moveTo(MARGIN_LEFT, y - 6)
        .lineTo(CONTENT_RIGHT, y - 6)
        .lineWidth(0.5)
        .strokeColor(LIGHT_MUTED)
        .stroke();

      for (let i = 0; i < logos.length; i += perRow) {
        const rowLogos = logos.slice(i, i + perRow);
        const rowWidth = rowLogos.length * logoWidth + (rowLogos.length - 1) * BRAND_LOGO_GAP_X;
        let x = MARGIN_LEFT + Math.max(0, (CONTENT_WIDTH - rowWidth) / 2);

        for (const logo of rowLogos) {
          try {
            doc.image(logo, x, y, {
              fit: [logoWidth, BRAND_LOGO_HEIGHT],
              align: "center",
              valign: "center",
            });
          } catch {
            // Skip logos that cannot be embedded
          }
          x += logoWidth + BRAND_LOGO_GAP_X;
        }
        logosBottom = y + BRAND_LOGO_HEIGHT;
        y += BRAND_LOGO_HEIGHT + BRAND_LOGO_GAP_Y;
      }

      pageNumberY = Math.min(logosBottom + PAGE_NUMBER_GAP, maxPageNumberY);
    }

    if (totalPages <= 1) return;

    // Keep cursor inside this page before writing — avoids PdfKit appending a page.
    doc.x = MARGIN_LEFT;
    doc.y = pageNumberY;

    doc
      .fillColor(LIGHT_MUTED)
      .font("Helvetica")
      .fontSize(PAGE_NUMBER_FONT_SIZE)
      .text(`Page ${page} of ${totalPages}`, MARGIN_LEFT, pageNumberY, {
        width: CONTENT_WIDTH,
        align: "center",
        lineBreak: false,
        height: PAGE_NUMBER_FONT_SIZE + 2,
      });
  });
}

export function buildQuotationPdfBuffer(input: QuotationPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const brandLogos = input.brandLogos || [];
    // Footer height already includes pad below logos for "Page X of Y"
    const footerHeight = measureBrandLogoFooterHeight(brandLogos.length);
    const contentBottom = PAGE_HEIGHT - Math.max(MARGIN_TOP, footerHeight) - 8;

    const doc = new PDFDocument({
      size: "A4",
      bufferPages: true,
      margins: {
        top: MARGIN_TOP,
        bottom: Math.max(MARGIN_TOP, footerHeight),
        left: MARGIN_LEFT,
        right: MARGIN_RIGHT,
      },
    });
    const chunks: Buffer[] = [];
    const gstMode = input.gstMode || "exclusive";

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const now = new Date();
    const validUntil = new Date(now);
    validUntil.setDate(validUntil.getDate() + 1);
    const colWidths = [
      CONTENT_WIDTH * 0.46,
      CONTENT_WIDTH * 0.14,
      CONTENT_WIDTH * 0.18,
      CONTENT_WIDTH * 0.22,
    ];

    // Title → company details
    let y = drawHeader(doc, input.companyProfile);

    // Meta + customer
    const leftColWidth = CONTENT_WIDTH * 0.55;
    const rightColX = MARGIN_LEFT + leftColWidth + 16;
    const labelWidth = 78;
    const infoStartY = y;

    doc.fillColor(INK).font("Helvetica").fontSize(9);
    const infoLines: Array<[string, string]> = [
      ["Quotation No:", `#${input.quotationNumber}`],
      ["Date:", formatDateDdMmYyyy(now)],
      ["Valid Until:", formatDateDdMmYyyy(validUntil)],
    ];

    for (const [label, value] of infoLines) {
      doc.font("Helvetica-Bold").text(label, MARGIN_LEFT, y, { width: labelWidth, continued: false });
      doc.font("Helvetica").text(value, MARGIN_LEFT + labelWidth, y);
      y += 13;
    }

    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(10)
      .text((input.customer.name || "Customer").toUpperCase(), rightColX, infoStartY, {
        width: CONTENT_WIDTH - leftColWidth - 16,
      });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(MUTED)
      .text(input.customer.company || "—", rightColX, doc.y + 1)
      .text(input.customer.phone || "—", rightColX, doc.y + 1);

    y = Math.max(y, doc.y) + 6;
    drawDivider(doc, y);
    y += 10;

    drawTableHeader(doc, y, colWidths);
    y += 20;

    for (const item of input.items) {
      if (y > contentBottom - 80) {
        doc.addPage();
        y = MARGIN_TOP;
      }

      const unitRate = displayUnitRate(item.rate || 0, input.gstPercent, gstMode);
      const lineTotal = item.qty * unitRate;
      const rowHeight = drawTableRow(
        doc,
        y,
        colWidths,
        [
          item.productName,
          `${item.qty} ${item.unit || "pcs"}`,
          formatInr(unitRate),
          formatInr(lineTotal),
        ],
        ["left", "center", "right", "right"]
      );
      y += rowHeight + 2;
    }

    y += 8;
    const totalsWidth = 240;
    const totalsX = CONTENT_RIGHT - totalsWidth;
    const totalsLabelWidth = totalsWidth * 0.55;
    const totalsValueWidth = totalsWidth - 14;
    const deliveryCharge = input.deliveryCharge ?? 0;
    const roundOff = input.roundOff ?? 0;
    const totalsRows: Array<{ label: string; value: string }> = [
      { label: "Subtotal", value: formatInr(input.subtotal) },
      { label: "Delivery charges", value: formatInr(deliveryCharge) },
      ...(input.gstPercent > 0
        ? [{ label: `GST (${input.gstPercent}%)`, value: formatInr(input.gstAmount) }]
        : []),
      ...(Math.abs(roundOff) > 0.0001
        ? [{ label: "Round Off", value: formatInr(roundOff) }]
        : []),
    ];

    if (y > contentBottom - 40 - totalsRows.length * 18) {
      doc.addPage();
      y = MARGIN_TOP;
    }

    doc.font("Helvetica").fontSize(10).fillColor(MUTED);
    for (const row of totalsRows) {
      doc.text(row.label, totalsX, y, { width: totalsLabelWidth, align: "left" });
      doc.text(row.value, totalsX, y, { width: totalsValueWidth, align: "right", lineBreak: false });
      y += 18;
    }

    y += 4;
    doc.rect(totalsX, y, totalsWidth, 26).fill(BRAND);
    doc
      .fillColor(WHITE)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("Total", totalsX + 10, y + 8, { width: totalsLabelWidth, align: "left" });
    doc.text(formatInr(input.grandTotal), totalsX, y + 8, {
      width: totalsValueWidth,
      align: "right",
      lineBreak: false,
    });

    y += 44;
    y = drawBankAndQr(doc, y, input, contentBottom);

    if (y > contentBottom - 120) {
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

    // Capture page count before drawing footers — footer text must not add pages.
    const range = doc.bufferedPageRange();
    const totalPages = range.count;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(range.start + i);
      drawFooterAndPageNumber(doc, brandLogos, i + 1, totalPages);
    }

    doc.end();
  });
}
