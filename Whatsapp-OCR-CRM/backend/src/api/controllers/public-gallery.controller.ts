import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { getBuffer } from "../../lib/s3";
import { logger } from "../../utils/logger";

export async function downloadGalleryPdf(req: Request, res: Response) {
  const { id } = req.params;

  try {
    const gallery = await prisma.gallery.findUnique({ where: { id } });
    if (!gallery?.pdfS3Key) {
      return res.status(404).send("Gallery PDF not found");
    }

    const buffer = await getBuffer(gallery.pdfS3Key);
    const filename = `${gallery.name.replace(/[^a-z0-9-_]+/gi, "-") || "gallery"}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    return res.send(buffer);
  } catch (error) {
    logger.error(`Failed to serve gallery PDF ${id}: ${error}`);
    return res.status(500).send("Failed to load gallery PDF");
  }
}
