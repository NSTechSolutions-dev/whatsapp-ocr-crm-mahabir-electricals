import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { getBuffer } from "../../lib/s3";
import { ensureQuotationTallyXml } from "../../services/quotation.service";
import { logger } from "../../utils/logger";

export async function downloadQuotationPdf(req: Request, res: Response) {
  const { id } = req.params;

  try {
    const quotation = await prisma.quotation.findUnique({ where: { id } });
    if (!quotation) {
      return res.status(404).send("Quotation not found");
    }

    const buffer = await getBuffer(quotation.s3Key);
    const ext = quotation.s3Key.split(".").pop()?.toLowerCase();
    let contentType = "application/octet-stream";
    if (ext === "pdf") contentType = "application/pdf";
    else if (ext === "html") contentType = "text/html";

    const filename = `${quotation.number}.${ext || "pdf"}`;
    const download = req.query.download === "1" || req.query.download === "true";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader(
      "Content-Disposition",
      download ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`
    );
    return res.send(buffer);
  } catch (error) {
    logger.error(`Failed to serve quotation PDF ${id}: ${error}`);
    return res.status(500).send("Failed to load quotation");
  }
}

export async function downloadQuotationTally(req: Request, res: Response) {
  const { id } = req.params;

  try {
    const quotation = await prisma.quotation.findUnique({ where: { id } });
    if (!quotation) {
      return res.status(404).send("Quotation not found");
    }

    const tallyKey = await ensureQuotationTallyXml(id);
    const buffer = await getBuffer(tallyKey);
    const filename = `${quotation.number}.xml`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error) {
    logger.error(`Failed to serve quotation Tally XML ${id}: ${error}`);
    return res.status(500).send("Failed to load Tally XML");
  }
}
