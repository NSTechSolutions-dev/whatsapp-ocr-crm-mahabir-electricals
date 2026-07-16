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
    companyAddress: orEnv(settings.companyAddress, env.COMPANY_ADDRESS),
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
    companyAddress,
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
      companyAddress: companyAddress?.trim() || null,
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

export async function listBrandLogos(req: Request, res: Response) {
  try {
    const logos = await prisma.brandLogo.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    const items = await Promise.all(
      logos.map(async (logo) => {
        let url: string | null = null;
        try {
          url = await getPresignedUrl(logo.s3Key, 3600);
        } catch (error) {
          logger.warn(`Could not presign brand logo ${logo.id}: ${error}`);
        }
        return {
          id: logo.id,
          name: logo.name,
          s3Key: logo.s3Key,
          sortOrder: logo.sortOrder,
          url,
          createdAt: logo.createdAt.toISOString(),
        };
      })
    );
    return res.json({ items });
  } catch (error) {
    logger.error("Error listing brand logos: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function uploadBrandLogo(req: Request, res: Response) {
  const file = req.file;
  const name = (req.body?.name as string | undefined)?.trim() || null;

  if (!file) {
    return res.status(400).json({ detail: "Logo image file is required" });
  }

  const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"];
  if (!allowed.includes(file.mimetype)) {
    return res.status(400).json({ detail: "Only PNG, JPEG, WebP, or SVG images are allowed" });
  }

  try {
    const ext =
      file.mimetype === "image/png"
        ? "png"
        : file.mimetype === "image/webp"
          ? "webp"
          : file.mimetype === "image/svg+xml"
            ? "svg"
            : "jpg";
    const key = `settings/brand-logos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await upload(key, file.buffer, file.mimetype);

    const count = await prisma.brandLogo.count();
    const logo = await prisma.brandLogo.create({
      data: { name, s3Key: key, sortOrder: count },
    });

    const url = await getPresignedUrl(logo.s3Key, 3600);

    return res.json({
      ok: true,
      item: {
        id: logo.id,
        name: logo.name,
        s3Key: logo.s3Key,
        sortOrder: logo.sortOrder,
        url,
        createdAt: logo.createdAt.toISOString(),
      },
    });
  } catch (error) {
    logger.error("Error uploading brand logo: " + error);
    return res.status(500).json({ detail: "Failed to upload brand logo" });
  }
}

export async function deleteBrandLogo(req: Request, res: Response) {
  const { id } = req.params;

  try {
    const logo = await prisma.brandLogo.findUnique({ where: { id } });
    if (!logo) {
      return res.status(404).json({ detail: "Brand logo not found" });
    }

    await prisma.brandLogo.delete({ where: { id } });

    return res.json({ ok: true });
  } catch (error) {
    logger.error(`Error deleting brand logo ${id}: ` + error);
    return res.status(500).json({ detail: "Failed to delete brand logo" });
  }
}
