import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { upload, getPresignedUrl } from "../../lib/s3";
import { regenerateGalleryPdf } from "../../services/gallery.service";
import { sendTemplateMessage } from "../../services/whatsapp.service";
import { getGalleryPdfPublicUrl } from "../../utils/public-url";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "gallery";
}

async function serializeGalleryImage(image: { id: string; s3Key: string; sortOrder: number; createdAt: Date }) {
  let url: string | null = null;
  try {
    url = await getPresignedUrl(image.s3Key, 3600);
  } catch (error) {
    logger.warn(`Could not presign gallery image ${image.id}: ${error}`);
  }
  return {
    id: image.id,
    s3Key: image.s3Key,
    sortOrder: image.sortOrder,
    url,
    createdAt: image.createdAt.toISOString(),
  };
}

async function serializeGallery(
  gallery: {
    id: string;
    name: string;
    pdfS3Key: string | null;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    images: { id: string; s3Key: string; sortOrder: number; createdAt: Date }[];
  },
  includeImages = false
) {
  const firstImage = gallery.images[0];
  let thumbnailUrl: string | null = null;
  if (firstImage) {
    try {
      thumbnailUrl = await getPresignedUrl(firstImage.s3Key, 3600);
    } catch {
      // ignore
    }
  }

  const base = {
    id: gallery.id,
    name: gallery.name,
    pdfS3Key: gallery.pdfS3Key,
    hasPdf: Boolean(gallery.pdfS3Key),
    sortOrder: gallery.sortOrder,
    imageCount: gallery.images.length,
    thumbnailUrl,
    createdAt: gallery.createdAt.toISOString(),
    updatedAt: gallery.updatedAt.toISOString(),
  };

  if (!includeImages) return base;

  const images = await Promise.all(gallery.images.map(serializeGalleryImage));
  return { ...base, images };
}

export async function listGalleries(req: Request, res: Response) {
  try {
    const galleries = await prisma.gallery.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    });

    const items = await Promise.all(galleries.map((g) => serializeGallery(g, false)));
    return res.json({ items });
  } catch (error) {
    logger.error("Error listing galleries: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function getGallery(req: Request, res: Response) {
  const { id } = req.params;

  try {
    const gallery = await prisma.gallery.findUnique({
      where: { id },
      include: {
        images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    });

    if (!gallery) {
      return res.status(404).json({ detail: "Gallery not found" });
    }

    return res.json(await serializeGallery(gallery, true));
  } catch (error) {
    logger.error(`Error loading gallery ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function createGallery(req: Request, res: Response) {
  const name = String(req.body?.name || "").trim();
  if (!name) {
    return res.status(400).json({ detail: "Gallery name is required" });
  }

  try {
    const count = await prisma.gallery.count();
    const gallery = await prisma.gallery.create({
      data: { name, sortOrder: count },
      include: { images: true },
    });

    return res.status(201).json(await serializeGallery(gallery, true));
  } catch (error) {
    logger.error("Error creating gallery: " + error);
    return res.status(500).json({ detail: "Failed to create gallery" });
  }
}

export async function updateGallery(req: Request, res: Response) {
  const { id } = req.params;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : undefined;
  const imageOrder = Array.isArray(req.body?.imageOrder)
    ? (req.body.imageOrder as unknown[]).filter((x): x is string => typeof x === "string")
    : undefined;

  try {
    const gallery = await prisma.gallery.findUnique({
      where: { id },
      include: { images: true },
    });

    if (!gallery) {
      return res.status(404).json({ detail: "Gallery not found" });
    }

    if (name !== undefined && !name) {
      return res.status(400).json({ detail: "Gallery name cannot be empty" });
    }

    if (name !== undefined) {
      await prisma.gallery.update({ where: { id }, data: { name } });
    }

    if (imageOrder && imageOrder.length > 0) {
      const imageIds = new Set(gallery.images.map((img) => img.id));
      for (const imageId of imageOrder) {
        if (!imageIds.has(imageId)) {
          return res.status(400).json({ detail: `Unknown image id: ${imageId}` });
        }
      }

      await Promise.all(
        imageOrder.map((imageId, index) =>
          prisma.galleryImage.update({
            where: { id: imageId },
            data: { sortOrder: index },
          })
        )
      );
    }

    if (gallery.images.length === 0) {
      return res.status(400).json({ detail: "Gallery must have at least one image before saving" });
    }

    await regenerateGalleryPdf(id);

    const updated = await prisma.gallery.findUnique({
      where: { id },
      include: {
        images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    });

    return res.json({ ok: true, ...(await serializeGallery(updated!, true)) });
  } catch (error: any) {
    logger.error(`Error updating gallery ${id}: ` + error);
    return res.status(400).json({ detail: error?.message || "Failed to update gallery" });
  }
}

export async function uploadGalleryImage(req: Request, res: Response) {
  const { id } = req.params;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ detail: "Image file is required" });
  }

  const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  if (!allowed.includes(file.mimetype)) {
    return res.status(400).json({ detail: "Only PNG, JPEG, or WebP images are allowed" });
  }

  try {
    const gallery = await prisma.gallery.findUnique({ where: { id } });
    if (!gallery) {
      return res.status(404).json({ detail: "Gallery not found" });
    }

    const ext = file.mimetype === "image/png" ? "png" : file.mimetype === "image/webp" ? "webp" : "jpg";
    const key = `galleries/${id}/images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await upload(key, file.buffer, file.mimetype);

    const count = await prisma.galleryImage.count({ where: { galleryId: id } });
    const image = await prisma.galleryImage.create({
      data: { galleryId: id, s3Key: key, sortOrder: count },
    });

    return res.json({
      ok: true,
      item: await serializeGalleryImage(image),
    });
  } catch (error) {
    logger.error(`Error uploading gallery image for ${id}: ` + error);
    return res.status(500).json({ detail: "Failed to upload image" });
  }
}

export async function deleteGalleryImage(req: Request, res: Response) {
  const { id, imageId } = req.params;

  try {
    const image = await prisma.galleryImage.findFirst({
      where: { id: imageId, galleryId: id },
    });

    if (!image) {
      return res.status(404).json({ detail: "Image not found" });
    }

    await prisma.galleryImage.delete({ where: { id: imageId } });

    const remaining = await prisma.galleryImage.count({ where: { galleryId: id } });
    if (remaining === 0) {
      await prisma.gallery.update({ where: { id }, data: { pdfS3Key: null } });
    } else {
      const gallery = await prisma.gallery.findUnique({ where: { id } });
      if (gallery?.pdfS3Key) {
        try {
          await regenerateGalleryPdf(id);
        } catch (error) {
          logger.warn(`Could not regenerate gallery PDF after image delete: ${error}`);
        }
      }
    }

    return res.json({ ok: true });
  } catch (error) {
    logger.error(`Error deleting gallery image ${imageId}: ` + error);
    return res.status(500).json({ detail: "Failed to delete image" });
  }
}

export async function deleteGallery(req: Request, res: Response) {
  const { id } = req.params;

  try {
    const gallery = await prisma.gallery.findUnique({ where: { id } });
    if (!gallery) {
      return res.status(404).json({ detail: "Gallery not found" });
    }

    await prisma.gallery.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (error) {
    logger.error(`Error deleting gallery ${id}: ` + error);
    return res.status(500).json({ detail: "Failed to delete gallery" });
  }
}

export async function sendGalleryToCustomer(req: Request, res: Response) {
  const { id } = req.params;
  const conversationId = String(req.body?.conversationId || "").trim();

  if (!conversationId) {
    return res.status(400).json({ detail: "conversationId is required" });
  }

  try {
    const gallery = await prisma.gallery.findUnique({ where: { id } });
    if (!gallery) {
      return res.status(404).json({ detail: "Gallery not found" });
    }

    if (!gallery.pdfS3Key) {
      return res.status(400).json({ detail: "Save gallery first to generate the PDF" });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { customer: true },
    });

    if (!conversation?.customer) {
      return res.status(404).json({ detail: "Conversation not found" });
    }

    const customer = conversation.customer;
    const pdfProxyUrl = `${getGalleryPdfPublicUrl(id)}?v=${Date.now()}`;
    const templateName = env.MSG91_GALLERY_TEMPLATE;
    const customerName = customer.name?.trim() || "Customer";

    const messageId = await sendTemplateMessage(
      customer.phone,
      templateName,
      {
        variables: [customerName, gallery.name],
        templateNamespace: null,
        documentHeader: {
          url: pdfProxyUrl,
          filename: `${slugify(gallery.name)}.pdf`,
        },
      },
      conversationId
    );

    return res.json({
      ok: true,
      messageId,
      galleryId: id,
      galleryName: gallery.name,
    });
  } catch (error: any) {
    logger.error(`Error sending gallery ${id}: ` + error);
    return res.status(500).json({ detail: error?.message || "Failed to send gallery" });
  }
}
