import { Request, Response } from "express";
import axios from "axios";
import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { upload } from "../../lib/s3";
import { inboundQueue } from "../../jobs/queues";
import { createOcrJobState, findActiveJobForMessage } from "../../lib/ocr-job-state";
import { attachWhatsappImage } from "../../services/inquiry-grouping.service";
import { verifyMsg91Signature } from "../../lib/msg91";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { normalizePhone } from "../../utils/phone";
import {
  ensureConversationForCustomer,
  findOrCreateCustomerByPhone,
} from "../../services/conversation.service";
import {
  claimInboundDedup,
  collectInboundDedupeKeys,
  normalizeMessageContent,
  parseMsg91Inbound,
} from "../../utils/webhook-dedup";

async function findRecentDuplicateMessage(
  conversationId: string,
  msgType: string,
  content: string | null,
  sourceMediaUrl: string | null
) {
  const since = new Date(Date.now() - 120_000);
  const trimmed = normalizeMessageContent(content);

  if (trimmed) {
    const recent = await prisma.whatsappMessage.findMany({
      where: {
        conversationId,
        direction: "INBOUND",
        type: msgType,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    const dup = recent.find((m) => normalizeMessageContent(m.content) === trimmed);
    if (dup) return dup;
  }

  if (sourceMediaUrl) {
    return prisma.whatsappMessage.findFirst({
      where: {
        conversationId,
        direction: "INBOUND",
        type: msgType,
        createdAt: { gte: since },
        OR: [{ mediaUrl: sourceMediaUrl }, { content: sourceMediaUrl }],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  return null;
}

async function upsertInboundMessage(
  phone: string,
  name: string | null,
  msgType: string,
  content: string | null,
  mediaUrl: string | null,
  waMessageId: string | null,
  sourceMediaUrl: string | null
) {
  const normalizedPhone = normalizePhone(phone);

  if (waMessageId) {
    const existing = await prisma.whatsappMessage.findFirst({
      where: { waMessageId, direction: "INBOUND" },
      include: {
        conversation: { include: { customer: true } },
      },
    });
    if (existing) {
      logger.info(`Skipping duplicate inbound webhook (waMessageId=${waMessageId})`);
      return {
        customer: existing.conversation.customer,
        conversation: existing.conversation,
        message: existing,
        duplicate: true as const,
      };
    }
  }

  let customer = await findOrCreateCustomerByPhone(normalizedPhone, { name });
  if (name && !customer.name) {
    customer = await prisma.customer.update({
      where: { id: customer.id },
      data: { name },
    });
  }

  const conversation = await ensureConversationForCustomer(customer.id);

  const recentDuplicate = await findRecentDuplicateMessage(
    conversation.id,
    msgType,
    content,
    sourceMediaUrl
  );
  if (recentDuplicate) {
    logger.info(
      `Skipping recent duplicate inbound message in conversation ${conversation.id} (messageId=${recentDuplicate.id})`
    );
    return {
      customer,
      conversation,
      message: recentDuplicate,
      duplicate: true as const,
    };
  }

  const message = await prisma.whatsappMessage.create({
    data: {
      conversationId: conversation.id,
      direction: "INBOUND",
      type: msgType,
      content,
      mediaUrl,
      waMessageId,
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });

  return { customer, conversation, message, duplicate: false as const };
}

async function loadWaitingEnquiryPayload(enquiryId: string) {
  const enquiry = await prisma.enquiry.findUnique({
    where: { id: enquiryId },
    include: {
      images: { orderBy: [{ pageNumber: "asc" }, { uploadedAt: "asc" }] },
    },
  });
  if (!enquiry) return null;

  const remainingSeconds = enquiry.processAt
    ? Math.max(0, Math.ceil((enquiry.processAt.getTime() - Date.now()) / 1000))
    : 0;

  return {
    enquiryId: enquiry.id,
    status: enquiry.status,
    processAt: enquiry.processAt?.toISOString() || null,
    remainingSeconds,
    imageCount: enquiry.images.length,
    images: enquiry.images.map((img) => ({
      id: img.id,
      pageNumber: img.pageNumber,
      imageUrl: img.imageUrl,
      uploadedAt: img.uploadedAt.toISOString(),
    })),
    conversationId: enquiry.conversationId,
    customerId: enquiry.customerId,
  };
}

async function routeInboundProcessing(opts: {
  io: any;
  conversation: { id: string };
  customer: { id: string };
  message: { id: string };
  msgType: string;
  content: string | null;
  mediaUrl: string | null;
  preview: string;
}) {
  const { io, conversation, customer, message, msgType, content, mediaUrl, preview } = opts;

  if (msgType === "image" && mediaUrl) {
    const admin = await prisma.user.findFirst({
      where: { role: "ADMIN", isActive: true },
      select: { id: true },
    });

    const result = await attachWhatsappImage({
      customerId: customer.id,
      conversationId: conversation.id,
      messageId: message.id,
      imageUrl: mediaUrl,
      createdById: admin?.id || "",
    });

    const payload = await loadWaitingEnquiryPayload(result.enquiryId);

    if (io) {
      io.to(`conversation:${conversation.id}`).emit("new_message", message);
      if (payload) {
        if (result.isNewEnquiry) {
          io.to(`conversation:${conversation.id}`).emit("enquiry_waiting", payload);
        } else {
          io.to(`conversation:${conversation.id}`).emit("enquiry_image_added", payload);
        }
      }
      io.emit("inbox_update", {
        conversationId: conversation.id,
        customerId: customer.id,
        lastMessagePreview: preview,
      });
    }

    return {
      ok: true,
      conversationId: conversation.id,
      messageId: message.id,
      enquiryId: result.enquiryId,
      grouped: true,
    };
  }

  const existingJobId = await findActiveJobForMessage(message.id);
  if (existingJobId) {
    logger.info(`Skipping duplicate OCR job for message ${message.id} (existing job ${existingJobId})`);
    return {
      ok: true,
      conversationId: conversation.id,
      messageId: message.id,
      jobId: existingJobId,
      deduped: true,
    };
  }

  const jobId = await createOcrJobState({
    conversationId: conversation.id,
    customerId: customer.id,
    messageId: message.id,
    msgType,
    mediaUrl,
    source: "webhook",
  });

  await inboundQueue.add(
    "processMessage",
    {
      jobId,
      messageId: message.id,
      msgType,
      content,
      mediaUrl,
      customerId: customer.id,
      conversationId: conversation.id,
      source: "webhook",
    },
    {
      jobId: `inbound-msg-${message.id}`,
      removeOnComplete: true,
      removeOnFail: 100,
    }
  );

  if (io) {
    io.to(`conversation:${conversation.id}`).emit("new_message", message);
    io.to(`conversation:${conversation.id}`).emit("ocr_job_started", {
      jobId,
      conversationId: conversation.id,
    });
    io.emit("inbox_update", {
      conversationId: conversation.id,
      customerId: customer.id,
      lastMessagePreview: preview,
    });
  }

  return {
    ok: true,
    conversationId: conversation.id,
    messageId: message.id,
    jobId,
  };
}

export async function msg91Webhook(req: Request, res: Response) {
  logger.info(`Received Webhook request: Headers=${JSON.stringify(req.headers)}, Body=${JSON.stringify(req.body)}`);
  const signature = req.headers["x-msg91-signature"] as string;
  const isMock = process.env.MSG91_MOCK !== "0";

  if (!isMock) {
    const shouldSkip = env.MSG91_WEBHOOK_SECRET === "skip" || env.MSG91_WEBHOOK_SECRET.includes("dummy");
    if (!shouldSkip) {
      if (!signature || !verifyMsg91Signature((req as any).rawBody, signature, env.MSG91_WEBHOOK_SECRET)) {
        return res.status(401).json({ detail: "Invalid signature" });
      }
    }
  }

  const payload = req.body as Record<string, unknown>;
  const { phone, msgType, name, content, sourceMediaUrl, waMessageId } = parseMsg91Inbound(payload);

  if (!phone) {
    logger.warn("Webhook request rejected: phone/customerNumber is missing");
    return res.status(400).json({ detail: "Missing phone" });
  }

  const hasContent = Boolean(normalizeMessageContent(content));
  const hasMedia = Boolean(sourceMediaUrl);
  if (!hasContent && !hasMedia) {
    logger.info(`Ignoring empty inbound webhook from ${phone} (no text or media)`);
    return res.json({ ok: true, ignored: true, reason: "empty_payload" });
  }

  const dedupeKeys = collectInboundDedupeKeys({
    waMessageId,
    phone,
    msgType,
    content,
    sourceMediaUrl,
    rawBody: (req as { rawBody?: Buffer }).rawBody,
  });

  if (!(await claimInboundDedup(dedupeKeys))) {
    logger.info(`Duplicate inbound webhook suppressed (keys=${dedupeKeys.join(",")})`);
    return res.json({ ok: true, duplicate: true, dedupeKeys });
  }

  let mediaUrl = sourceMediaUrl;

  try {
    if (msgType === "image" && mediaUrl) {
      try {
        const response = await axios.get(mediaUrl, { responseType: "arraybuffer" });
        const buffer = Buffer.from(response.data);
        const today = new Date().toISOString().slice(0, 10);
        const uuid = crypto.randomUUID();
        const key = `uploads/whatsapp/${today}/${uuid}.png`;
        await upload(key, buffer, "image/png");
        mediaUrl = key;
      } catch (err) {
        logger.error("Failed to download or upload webhook media: " + err);
      }
    }

    const { conversation, message, customer, duplicate } = await upsertInboundMessage(
      phone,
      name,
      msgType,
      content,
      mediaUrl,
      waMessageId,
      sourceMediaUrl
    );

    if (duplicate) {
      return res.json({
        ok: true,
        duplicate: true,
        conversationId: conversation.id,
        messageId: message.id,
      });
    }

    const io = req.app.get("io");
    const result = await routeInboundProcessing({
      io,
      conversation,
      customer,
      message,
      msgType,
      content,
      mediaUrl,
      preview: content || "[image]",
    });

    return res.json(result);
  } catch (error) {
    logger.error("MSG91 Webhook handler failed: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function simulateInbound(req: Request, res: Response) {
  const { phone, name, type, content, mediaDataUrl, mediaUrl } = req.body;
  const msgType = type || "text";

  let finalMediaUrl = mediaUrl || null;

  try {
    if (msgType === "image") {
      if (mediaDataUrl && mediaDataUrl.startsWith("data:")) {
        const [header, b64] = mediaDataUrl.split(",");
        const buffer = Buffer.from(b64, "base64");
        const today = new Date().toISOString().slice(0, 10);
        const uuid = crypto.randomUUID();
        const ext = header.includes("jpeg") || header.includes("jpg") ? "jpg" : "png";
        const key = `uploads/whatsapp/${today}/${uuid}.${ext}`;
        await upload(key, buffer, `image/${ext}`);
        finalMediaUrl = key;
      }
    }

    const { conversation, message, customer, duplicate } = await upsertInboundMessage(
      phone,
      name || null,
      msgType,
      content || null,
      finalMediaUrl,
      `sim-${Date.now()}`,
      mediaUrl || null
    );

    if (duplicate) {
      return res.json({
        ok: true,
        duplicate: true,
        conversationId: conversation.id,
        messageId: message.id,
      });
    }

    const io = req.app.get("io");
    const result = await routeInboundProcessing({
      io,
      conversation,
      customer,
      message,
      msgType,
      content: content || null,
      mediaUrl: finalMediaUrl,
      preview: content || "[image]",
    });

    return res.json(result);
  } catch (error) {
    logger.error("Webhook simulation failed: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}
