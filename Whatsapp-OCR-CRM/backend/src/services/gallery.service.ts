import { prisma } from "../lib/prisma";
import { upload, getBuffer } from "../lib/s3";
import { buildGalleryPdfBuffer } from "../lib/gallery-pdf";
import { env } from "../config/env";
import { logger } from "../utils/logger";

async function getCompanyName(): Promise<string> {
  const settings = await prisma.companySetting.findUnique({ where: { id: "default" } });
  const fromDb = settings?.companyName?.trim();
  return fromDb || env.COMPANY_NAME;
}

export async function regenerateGalleryPdf(galleryId: string): Promise<string> {
  const gallery = await prisma.gallery.findUnique({
    where: { id: galleryId },
    include: { images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });

  if (!gallery) {
    throw new Error("Gallery not found");
  }
  if (gallery.images.length === 0) {
    throw new Error("Gallery must have at least one image");
  }

  const imageBuffers: Buffer[] = [];
  for (const image of gallery.images) {
    imageBuffers.push(await getBuffer(image.s3Key));
  }

  const companyName = await getCompanyName();
  const pdfBuffer = await buildGalleryPdfBuffer({
    title: gallery.name,
    companyName,
    images: imageBuffers,
  });

  const key = `galleries/${galleryId}/catalog.pdf`;
  await upload(key, pdfBuffer, "application/pdf");

  await prisma.gallery.update({
    where: { id: galleryId },
    data: { pdfS3Key: key },
  });

  logger.info(`Regenerated gallery PDF for ${galleryId}`);
  return key;
}
