import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { upload, getPresignedUrl } from "../../lib/s3";
import { logger } from "../../utils/logger";
import { env } from "../../config/env";

async function getOrCreateCompanySetting() {
  const existing = await prisma.companySetting.findUnique({ where: { id: "default" } });
  if (existing) return existing;
  return prisma.companySetting.create({ data: { id: "default" } });
}

function orEnv(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function serializeSettings(settings: Awaited<ReturnType<typeof getOrCreateCompanySetting>>, qrUrl: string | null) {
  return {
    companyName: orEnv(settings.companyName, env.COMPANY_NAME),
    companyPhone: orEnv(settings.companyPhone, env.COMPANY_PHONE),
    companyGstin: orEnv(settings.companyGstin, env.COMPANY_GSTIN),
    bankName: settings.bankName,
    accountName: settings.accountName,
    accountNumber: settings.accountNumber,
    ifsc: settings.ifsc,
    branch: settings.branch,
    upiId: settings.upiId,
    qrS3Key: settings.qrS3Key,
    qrUrl,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export async function getCompanySettings(req: Request, res: Response) {
  try {
    const settings = await getOrCreateCompanySetting();
    let qrUrl: string | null = null;
    if (settings.qrS3Key) {
      try {
        qrUrl = await getPresignedUrl(settings.qrS3Key, 3600);
      } catch (error) {
        logger.warn(`Could not presign QR URL: ${error}`);
      }
    }

    return res.json(serializeSettings(settings, qrUrl));
  } catch (error) {
    logger.error("Error loading company settings: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function updateCompanySettings(req: Request, res: Response) {
  const {
    companyName,
    companyPhone,
    companyGstin,
    bankName,
    accountName,
    accountNumber,
    ifsc,
    branch,
    upiId,
  } = req.body ?? {};

  try {
    const data = {
      companyName: companyName?.trim() || null,
      companyPhone: companyPhone?.trim() || null,
      companyGstin: companyGstin?.trim() || null,
      bankName: bankName?.trim() || null,
      accountName: accountName?.trim() || null,
      accountNumber: accountNumber?.trim() || null,
      ifsc: ifsc?.trim() || null,
      branch: branch?.trim() || null,
      upiId: upiId?.trim() || null,
    };

    const settings = await prisma.companySetting.upsert({
      where: { id: "default" },
      update: data,
      create: { id: "default", ...data },
    });

    let qrUrl: string | null = null;
    if (settings.qrS3Key) {
      qrUrl = await getPresignedUrl(settings.qrS3Key, 3600);
    }

    return res.json({
      ok: true,
      ...serializeSettings(settings, qrUrl),
    });
  } catch (error) {
    logger.error("Error updating company settings: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function uploadPaymentQr(req: Request, res: Response) {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ detail: "QR image file is required" });
  }

  const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  if (!allowed.includes(file.mimetype)) {
    return res.status(400).json({ detail: "Only PNG, JPEG, or WebP images are allowed" });
  }

  try {
    const ext = file.mimetype === "image/png" ? "png" : file.mimetype === "image/webp" ? "webp" : "jpg";
    const key = `settings/payment-qr-${Date.now()}.${ext}`;
    await upload(key, file.buffer, file.mimetype);

    const settings = await prisma.companySetting.upsert({
      where: { id: "default" },
      update: { qrS3Key: key },
      create: { id: "default", qrS3Key: key },
    });

    const qrUrl = await getPresignedUrl(settings.qrS3Key!, 3600);

    return res.json({
      ok: true,
      qrS3Key: settings.qrS3Key,
      qrUrl,
      updatedAt: settings.updatedAt.toISOString(),
    });
  } catch (error) {
    logger.error("Error uploading payment QR: " + error);
    return res.status(500).json({ detail: "Failed to upload payment QR" });
  }
}
