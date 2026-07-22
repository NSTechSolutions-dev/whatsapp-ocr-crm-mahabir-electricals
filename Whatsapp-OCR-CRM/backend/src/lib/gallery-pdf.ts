import PDFDocument from "pdfkit";

type PdfDoc = InstanceType<typeof PDFDocument>;

const BRAND = "#7F1D1D";
const INK = "#2D3748";
const MUTED = "#718096";

const MARGIN_LEFT = 48;
const MARGIN_RIGHT = 48;
const MARGIN_TOP = 48;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const CONTENT_HEIGHT = PAGE_HEIGHT - MARGIN_TOP * 2;

export interface GalleryPdfInput {
  title: string;
  companyName?: string | null;
  images: Buffer[];
}

function drawTitlePage(doc: PdfDoc, input: GalleryPdfInput) {
  let y = MARGIN_TOP + 80;

  if (input.companyName?.trim()) {
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor(BRAND)
      .text(input.companyName.trim(), MARGIN_LEFT, y, { width: CONTENT_WIDTH, align: "center" });
    y = doc.y + 24;
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(28)
    .fillColor(INK)
    .text(input.title.trim(), MARGIN_LEFT, y, { width: CONTENT_WIDTH, align: "center" });

  y = doc.y + 16;
  doc
    .font("Helvetica")
    .fontSize(11)
    .fillColor(MUTED)
    .text("Product catalog", MARGIN_LEFT, y, { width: CONTENT_WIDTH, align: "center" });
}

function drawImagePage(doc: PdfDoc, image: Buffer) {
  doc.addPage();
  try {
    doc.image(image, MARGIN_LEFT, MARGIN_TOP, {
      fit: [CONTENT_WIDTH, CONTENT_HEIGHT],
      align: "center",
      valign: "center",
    });
  } catch {
    doc
      .font("Helvetica")
      .fontSize(12)
      .fillColor(MUTED)
      .text("Unable to render image", MARGIN_LEFT, MARGIN_TOP + 40, { width: CONTENT_WIDTH });
  }
}

export function buildGalleryPdfBuffer(input: GalleryPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN_TOP, bottom: MARGIN_TOP, left: MARGIN_LEFT, right: MARGIN_RIGHT },
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawTitlePage(doc, input);

    for (const image of input.images) {
      drawImagePage(doc, image);
    }

    doc.end();
  });
}
