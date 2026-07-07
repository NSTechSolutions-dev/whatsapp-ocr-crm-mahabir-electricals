import { prisma } from "../lib/prisma";
import { upload, getPresignedUrl, getBuffer } from "../lib/s3";
import { buildQuotationPdfBuffer } from "../lib/quotation-pdf";
import { logger } from "../utils/logger";

function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

type EnquiryWithRelations = {
  id: string;
  customer: {
    id: string;
    name: string | null;
    phone: string | null;
    company: string | null;
  };
  items: Array<{
    productName: string;
    qty: number;
    unit: string | null;
    rate: number | null;
  }>;
};

async function saveQuotationPdfForEnquiry(
  enquiry: EnquiryWithRelations,
  quotationNumber: string,
  gstPercent: number
) {
  let subtotal = 0;
  for (const item of enquiry.items) {
    subtotal += item.qty * (item.rate || 0);
  }
  const gstAmount = subtotal * (gstPercent / 100);
  const grandTotal = subtotal + gstAmount;

  const buffer = await buildQuotationPdfBuffer({
    quotationNumber,
    customer: enquiry.customer,
    items: enquiry.items,
    subtotal,
    gstPercent,
    gstAmount,
    grandTotal,
  });

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const key = `quotations/${year}/${month}/${enquiry.id}.pdf`;
  await upload(key, buffer, "application/pdf");
  const presignedUrl = await getPresignedUrl(key);

  return prisma.quotation.upsert({
    where: { enquiryId: enquiry.id },
    update: {
      s3Key: key,
      s3Url: presignedUrl,
      number: quotationNumber,
    },
    create: {
      enquiryId: enquiry.id,
      s3Key: key,
      s3Url: presignedUrl,
      number: quotationNumber,
    },
  });
}

export async function isQuotationPdfReady(s3Key: string): Promise<boolean> {
  try {
    const buffer = await getBuffer(s3Key);
    return isPdfBuffer(buffer);
  } catch {
    return s3Key.toLowerCase().endsWith(".pdf");
  }
}

export async function ensureQuotationPdf(quotationId: string, gstPercent = 18.0): Promise<any> {
  const existing = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      enquiry: {
        include: {
          customer: true,
          items: true,
        },
      },
    },
  });

  if (!existing) {
    throw new Error("Quotation not found");
  }

  try {
    const current = await getBuffer(existing.s3Key);
    if (isPdfBuffer(current)) {
      return existing;
    }
  } catch (error) {
    logger.warn(`Could not read quotation file ${existing.s3Key}: ${error}`);
  }

  logger.info(`Rebuilding PDF for quotation ${quotationId} using PdfKit`);
  return saveQuotationPdfForEnquiry(existing.enquiry, existing.number, gstPercent);
}

interface GenerateQuotationOptions {
  existingNumber?: string;
}

export async function regenerateQuotationPdf(quotationId: string, gstPercent = 18.0): Promise<any> {
  const existing = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { enquiryId: true, number: true },
  });

  if (!existing) {
    throw new Error("Quotation not found");
  }

  return generateQuotation(existing.enquiryId, gstPercent, {
    existingNumber: existing.number,
  });
}

export async function generateQuotation(
  enquiryId: string,
  gstPercent = 18.0,
  options: GenerateQuotationOptions = {}
): Promise<any> {
  const enquiry = await prisma.enquiry.findUnique({
    where: { id: enquiryId },
    include: {
      customer: true,
      items: true,
    },
  });

  if (!enquiry) {
    throw new Error("Enquiry not found");
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");

  let quotationNumber = options.existingNumber;
  if (!quotationNumber) {
    const sequenceKey = `quotation-${year}-${month}`;
    let seqNum = 1;
    await prisma.$transaction(async (tx) => {
      const existingSeq: any[] = await tx.$queryRaw`
        SELECT * FROM "Sequence" WHERE key = ${sequenceKey} FOR UPDATE
      `;

      if (existingSeq.length > 0) {
        seqNum = existingSeq[0].value + 1;
        await tx.$queryRaw`
          UPDATE "Sequence" SET value = ${seqNum}, "updatedAt" = NOW() WHERE key = ${sequenceKey}
        `;
      } else {
        await tx.$executeRaw`
          INSERT INTO "Sequence" (id, key, value, "updatedAt") 
          VALUES (${`seq_${Date.now()}`}, ${sequenceKey}, 1, NOW())
        `;
        seqNum = 1;
      }
    });

    quotationNumber = `QT-${year}-${month}-${String(seqNum).padStart(5, "0")}`;
  }

  logger.info(`Generating quotation PDF ${quotationNumber} for enquiry ${enquiryId}`);
  return saveQuotationPdfForEnquiry(enquiry, quotationNumber, gstPercent);
}
