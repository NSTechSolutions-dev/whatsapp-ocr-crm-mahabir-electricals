import { Request, Response } from "express";
import axios from "axios";
import crypto from "crypto";
import { prisma } from "../../lib/prisma";
import { upload } from "../../lib/s3";
import { inboundQueue } from "../../jobs/queues";
import { createOcrJobState } from "../../lib/ocr-job-state";
import { verifyMsg91Signature } from "../../lib/msg91";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { normalizePhone } from "../../utils/phone";

async function upsertInboundMessage(
  phone: string,
  name: string | null,
  msgType: string,
  content: string | null,
  mediaUrl: string | null,
  waMessageId: string | null
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

  // 1. Upsert Customer
  let customer = await prisma.customer.findUnique({ where: { phone: normalizedPhone } });
  if (!customer) {
    customer = await prisma.customer.create({
      data: { phone: normalizedPhone, name },
    });
  } else if (name && !customer.name) {
    customer = await prisma.customer.update({
      where: { id: customer.id },
      data: { name },
    });
  }

  // 2. Upsert Conversation
  const waConversationId = `wa-${customer.id}`;
  let conversation = await prisma.conversation.findUnique({
    where: { waConversationId },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        customerId: customer.id,
        waConversationId,
        status: "open",
      },
    });
  }

  // 3. Create Message
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

  // 4. Update Conversation timestamp
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });

  return { customer, conversation, message, duplicate: false as const };
}

export async function msg91Webhook(req: Request, res: Response) {
  logger.info(`Received Webhook request: Headers=${JSON.stringify(req.headers)}, Body=${JSON.stringify(req.body)}`);
  const signature = req.headers["x-msg91-signature"] as string;
  const isMock = process.env.MSG91_MOCK !== "0";

  // Signature check
  if (!isMock) {
    const shouldSkip = env.MSG91_WEBHOOK_SECRET === "skip" || env.MSG91_WEBHOOK_SECRET.includes("dummy");
    if (!shouldSkip) {
      if (!signature || !verifyMsg91Signature((req as any).rawBody, signature, env.MSG91_WEBHOOK_SECRET)) {
        return res.status(401).json({ detail: "Invalid signature" });
      }
    }
  }

  const payload = req.body;
  const phone = payload.customerNumber || payload.from || payload.phone;
  const msgType = payload.contentType || payload.messageType || payload.type || "text";
  const name = payload.customerName || payload.name || null;
  const content = payload.text || payload.content || null;
  let mediaUrl = payload.url || payload.mediaUrl || null;
  const waMessageId =
    payload.uuid ||
    payload.messageId ||
    payload.message_id ||
    payload.messages?.[0]?.id ||
    payload.messages?.[0]?.uuid ||
    null;

  if (!phone) {
    logger.warn("Webhook request rejected: phone/customerNumber is missing");
    return res.status(400).json({ detail: "Missing phone" });
  }

  try {
    // If type is image, download media and upload to S3
    if (msgType === "image" && mediaUrl) {
      try {
        const response = await axios.get(mediaUrl, { responseType: "arraybuffer" });
        const buffer = Buffer.from(response.data);
        const today = new Date().toISOString().slice(0, 10);
        const uuid = crypto.randomUUID();
        const key = `uploads/whatsapp/${today}/${uuid}.png`;
        await upload(key, buffer, "image/png");
        // Use key as mediaUrl or getPresignedUrl
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
      waMessageId
    );

    if (duplicate) {
      return res.json({
        ok: true,
        duplicate: true,
        conversationId: conversation.id,
        messageId: message.id,
      });
    }

    const jobId = await createOcrJobState({
      conversationId: conversation.id,
      customerId: customer.id,
      messageId: message.id,
      msgType,
      mediaUrl,
      source: "webhook",
    });

    await inboundQueue.add("processMessage", {
      jobId,
      messageId: message.id,
      msgType,
      content,
      mediaUrl,
      customerId: customer.id,
      conversationId: conversation.id,
      source: "webhook",
    });

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation:${conversation.id}`).emit("new_message", message);
      io.to(`conversation:${conversation.id}`).emit("ocr_job_started", {
        jobId,
        conversationId: conversation.id,
      });
      io.emit("inbox_update", {
        conversationId: conversation.id,
        customerId: customer.id,
        lastMessagePreview: content || "[image]",
      });
    }

    return res.json({ ok: true, conversationId: conversation.id, messageId: message.id, jobId });
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

    const { conversation, message, customer } = await upsertInboundMessage(
      phone,
      name || null,
      msgType,
      content || null,
      finalMediaUrl,
      `sim-${Date.now()}`
    );

    const jobId = await createOcrJobState({
      conversationId: conversation.id,
      customerId: customer.id,
      messageId: message.id,
      msgType,
      mediaUrl: finalMediaUrl,
      source: "webhook",
    });

    await inboundQueue.add("processMessage", {
      jobId,
      messageId: message.id,
      msgType,
      content: content || null,
      mediaUrl: finalMediaUrl,
      customerId: customer.id,
      conversationId: conversation.id,
      source: "webhook",
    });

    const io = req.app.get("io");
    if (io) {
      io.to(`conversation:${conversation.id}`).emit("new_message", message);
      io.to(`conversation:${conversation.id}`).emit("ocr_job_started", {
        jobId,
        conversationId: conversation.id,
      });
      io.emit("inbox_update", {
        conversationId: conversation.id,
        customerId: customer.id,
        lastMessagePreview: content || "[image]",
      });
    }

    return res.json({ ok: true, conversationId: conversation.id, messageId: message.id, jobId });
  } catch (error) {
    logger.error("Webhook simulation failed: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}
