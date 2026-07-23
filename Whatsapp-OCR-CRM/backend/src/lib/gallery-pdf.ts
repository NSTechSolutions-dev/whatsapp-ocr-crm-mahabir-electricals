import PDFDocument from "pdfkit";
import { drawDocumentHeader, type PdfCompanyProfile } from "./quotation-pdf";

type PdfDoc = InstanceType<typeof PDFDocument>;

const MUTED = "#718096";
const LINE = "#E2E8F0";

const MARGIN_LEFT = 48;
const MARGIN_RIGHT = 48;
const MARGIN_TOP = 32;
const MARGIN_BOTTOM = 40;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN_RIGHT;

const IMAGES_PER_PAGE = 4;
const GRID_COLS = 2;
const GRID_ROWS = 2;
const GRID_GAP_X = 16;
const GRID_GAP_Y = 16;

export interface GalleryPdfInput {
  title: string;
  companyProfile?: PdfCompanyProfile | null;
  images: Buffer[];
}

function drawCatalogPage(
  doc: PdfDoc,
  pageImages: Buffer[],
  companyProfile: PdfCompanyProfile | null | undefined,
  isFirstPage: boolean
) {
  if (!isFirstPage) {
    doc.addPage();
  }

  let y = drawDocumentHeader(doc, companyProfile, "CATALOG");

  // Thin divider under header (same brand feel as quotation)
  doc
    .moveTo(MARGIN_LEFT, y)
    .lineTo(CONTENT_RIGHT, y)
    .lineWidth(2)
    .strokeColor("#7F1D1D")
    .stroke();
  y += 14;

  const availableHeight = PAGE_HEIGHT - MARGIN_BOTTOM - y;
  const cellWidth = (CONTENT_WIDTH - GRID_GAP_X) / GRID_COLS;
  const cellHeight = (availableHeight - GRID_GAP_Y) / GRID_ROWS;
  const imagePad = 8;

  for (let i = 0; i < IMAGES_PER_PAGE; i++) {
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    const x = MARGIN_LEFT + col * (cellWidth + GRID_GAP_X);
    const cellY = y + row * (cellHeight + GRID_GAP_Y);

    // Soft frame for each product slot
    doc
      .roundedRect(x, cellY, cellWidth, cellHeight, 4)
      .lineWidth(0.75)
      .strokeColor(LINE)
      .stroke();

    const image = pageImages[i];
    if (!image) continue;

    try {
      doc.image(image, x + imagePad, cellY + imagePad, {
        fit: [cellWidth - imagePad * 2, cellHeight - imagePad * 2],
        align: "center",
        valign: "center",
      });
    } catch {
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(MUTED)
        .text("Unable to render image", x + imagePad, cellY + cellHeight / 2 - 6, {
          width: cellWidth - imagePad * 2,
          align: "center",
        });
    }
  }
}

export function buildGalleryPdfBuffer(input: GalleryPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: {
        top: MARGIN_TOP,
        bottom: MARGIN_BOTTOM,
        left: MARGIN_LEFT,
        right: MARGIN_RIGHT,
      },
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const images = input.images || [];
    if (images.length === 0) {
      drawDocumentHeader(doc, input.companyProfile, "CATALOG");
      doc
        .font("Helvetica")
        .fontSize(12)
        .fillColor(MUTED)
        .text("No product images in this catalog.", MARGIN_LEFT, doc.y + 24, {
          width: CONTENT_WIDTH,
          align: "center",
        });
      doc.end();
      return;
    }

    for (let i = 0; i < images.length; i += IMAGES_PER_PAGE) {
      const pageImages = images.slice(i, i + IMAGES_PER_PAGE);
      drawCatalogPage(doc, pageImages, input.companyProfile, i === 0);
    }

    doc.end();
  });
}
