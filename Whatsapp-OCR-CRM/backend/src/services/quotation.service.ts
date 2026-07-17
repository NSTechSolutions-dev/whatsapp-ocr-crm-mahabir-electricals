import { prisma } from "../lib/prisma";
import { upload, getPresignedUrl, getBuffer } from "../lib/s3";
import { buildQuotationPdfBuffer } from "../lib/quotation-pdf";
import { logger } from "../utils/logger";
import { calculateGstTotals, type GstMode } from "../utils/gst-calculation";

function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

type EnquiryWithRelations = {
  id: string;
  gstPercent?: number;
  gstMode?: string;
  deliveryCharge?: number;
  billCustomerName?: string | null;
  billCustomerPhone?: string | null;
  billCustomerCompany?: string | null;
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

function resolveBillCustomer(enquiry: EnquiryWithRelations) {
  return {
    id: enquiry.customer.id,
    name: enquiry.billCustomerName ?? enquiry.customer.name,
    phone: enquiry.billCustomerPhone ?? enquiry.customer.phone,
    company: enquiry.billCustomerCompany ?? enquiry.customer.company,
  };
}

async function loadCompanyBillSettings() {
  const settings = await prisma.companySetting.findUnique({ where: { id: "default" } });
  if (!settings) {
    return {
      bank: null,
      qrImage: null as Buffer | null,
      companyProfile: null as {
        name?: string | null;
        address?: string | null;
        phone?: string | null;
        gstin?: string | null;
      } | null,
      brandLogos: [] as Buffer[],
    };
  }

  let qrImage: Buffer | null = null;
  if (settings.qrS3Key) {
    try {
      qrImage = await getBuffer(settings.qrS3Key);
    } catch (error) {
      logger.warn(`Could not load payment QR from ${settings.qrS3Key}: ${error}`);
    }
  }

  const brandLogoRecords = await prisma.brandLogo.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const brandLogos: Buffer[] = [];
  for (const logo of brandLogoRecords) {
    try {
      brandLogos.push(await getBuffer(logo.s3Key));
    } catch (error) {
      logger.warn(`Could not load brand logo from ${logo.s3Key}: ${error}`);
    }
  }

  return {
    bank: {
      bankName: settings.bankName,
      accountName: settings.accountName,
      accountNumber: settings.accountNumber,
      ifsc: settings.ifsc,
      branch: settings.branch,
      upiId: settings.upiId,
    },
    qrImage,
    companyProfile: {
      name: settings.companyName?.trim() || null,
      address: settings.companyAddress?.trim() || null,
      phone: settings.companyPhone?.trim() || null,
      gstin: settings.companyGstin?.trim() || null,
    },
    brandLogos,
  };
}

async function saveQuotationPdfForEnquiry(
  enquiry: EnquiryWithRelations,
  quotationNumber: string,
  gstPercent?: number,
  gstMode?: GstMode
) {
  const percent = gstPercent ?? enquiry.gstPercent ?? 18;
  const mode = (gstMode ?? enquiry.gstMode ?? "exclusive") as GstMode;
  const delivery = enquiry.deliveryCharge ?? 0;
  const lineItems = enquiry.items.map((item) => ({
    qty: item.qty,
    rate: item.rate || 0,
  }));
  const { subtotal, deliveryCharge, gstAmount, roundOff, grandTotal } = calculateGstTotals(
    lineItems,
    percent,
    mode,
    delivery
  );
  const { bank, qrImage, companyProfile, brandLogos } = await loadCompanyBillSettings();

  const buffer = await buildQuotationPdfBuffer({
    quotationNumber,
    customer: resolveBillCustomer(enquiry),
    items: enquiry.items,
    subtotal,
    deliveryCharge,
    gstPercent: percent,
    gstMode: mode,
    gstAmount,
    roundOff,
    grandTotal,
    bank,
    qrImage,
    companyProfile,
    brandLogos,
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

export async function ensureQuotationPdf(quotationId: string, gstPercent?: number, gstMode?: GstMode): Promise<any> {
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

  const percent = gstPercent ?? existing.enquiry.gstPercent ?? 18;
  const mode = (gstMode ?? existing.enquiry.gstMode ?? "exclusive") as GstMode;
  logger.info(`Rebuilding PDF for quotation ${quotationId} using PdfKit`);
  return saveQuotationPdfForEnquiry(existing.enquiry, existing.number, percent, mode);
}

interface GenerateQuotationOptions {
  existingNumber?: string;
  gstMode?: GstMode;
}

export async function regenerateQuotationPdf(
  quotationId: string,
  gstPercent?: number,
  gstMode?: GstMode
): Promise<any> {
  const existing = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { enquiryId: true, number: true },
  });

  if (!existing) {
    throw new Error("Quotation not found");
  }

  return generateQuotation(existing.enquiryId, gstPercent, {
    existingNumber: existing.number,
    gstMode,
  });
}

export async function generateQuotation(
  enquiryId: string,
  gstPercent?: number,
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

  const percent = gstPercent ?? enquiry.gstPercent ?? 18;
  const mode = (options.gstMode ?? enquiry.gstMode ?? "exclusive") as GstMode;

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
  return saveQuotationPdfForEnquiry(enquiry, quotationNumber, percent, mode);
}

export { calculateGstTotals, type GstMode };
