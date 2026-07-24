import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { logger } from "../../utils/logger";
import { sendTextMessage } from "../../services/whatsapp.service";
import { getConversationSessionState } from "../../utils/whatsapp-session";
import { normalizePhone } from "../../utils/phone";
import {
  ensureConversationForCustomer,
  findOrCreateCustomerByPhone,
} from "../../services/conversation.service";

export async function listConversations(req: Request, res: Response) {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const q = ((req.query.q as string) || "").toLowerCase();
  const skip = (page - 1) * limit;

  try {
    // Heal duplicate customers/conversations for phones that appear more than once
    const allCustomers = await prisma.customer.findMany({
      select: { id: true, phone: true },
    });
    const phoneBuckets = new Map<string, string[]>();
    for (const c of allCustomers) {
      const key = normalizePhone(c.phone) || c.phone;
      const bucket = phoneBuckets.get(key) || [];
      bucket.push(c.id);
      phoneBuckets.set(key, bucket);
    }
    for (const [phone, ids] of phoneBuckets) {
      if (ids.length > 1) {
        try {
          await findOrCreateCustomerByPhone(phone);
        } catch (err) {
          logger.warn(`Inbox phone merge failed for ${phone}: ${err}`);
        }
      }
    }

    // One inbox row per customer (most recent conversation)
    const convs = await prisma.conversation.findMany({
      orderBy: { lastMessageAt: "desc" },
      include: {
        customer: true,
      },
    });

    const seenCustomers = new Set<string>();
    const seenPhones = new Set<string>();
    const unique: typeof convs = [];

    for (const c of convs) {
      const phoneKey = normalizePhone(c.customer.phone) || c.customer.phone;
      if (seenCustomers.has(c.customerId) || seenPhones.has(phoneKey)) {
        void ensureConversationForCustomer(c.customerId).catch((err) =>
          logger.warn(`Background inbox merge failed for ${c.customerId}: ${err}`)
        );
        continue;
      }
      seenCustomers.add(c.customerId);
      seenPhones.add(phoneKey);
      unique.push(c);
    }

    const pageItems = unique.slice(skip, skip + limit);

    const enriched = [];
    for (const c of pageItems) {
      const lastMsg = await prisma.whatsappMessage.findFirst({
        where: { conversationId: c.id },
        orderBy: { createdAt: "desc" },
      });

      let preview = "";
      if (lastMsg) {
        preview = (lastMsg.content || (lastMsg.type === "image" ? "[image]" : "[message]")).slice(0, 80);
      }

      enriched.push({
        id: c.id,
        customer: {
          id: c.customer.id,
          phone: c.customer.phone,
          name: c.customer.name,
          company: c.customer.company,
        },
        lastMessageAt: c.lastMessageAt.toISOString(),
        lastMessagePreview: preview,
        unreadCount: 0,
        status: c.status,
      });
    }

    let filtered = enriched;
    if (q) {
      filtered = enriched.filter(
        (item) =>
          item.customer.phone.toLowerCase().includes(q) ||
          (item.customer.name && item.customer.name.toLowerCase().includes(q))
      );
    }

    return res.json({
      page,
      items: filtered,
    });
  } catch (error) {
    logger.error("Error listing conversations: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function getConversation(req: Request, res: Response) {
  const { conversationId } = req.params;

  try {
    let conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        customer: true,
      },
    });

    if (!conv) {
      return res.status(404).json({ detail: "Conversation not found" });
    }

    // Redirect callers to the single primary inbox if this was a duplicate
    const requestedId = conversationId;
    const primary = await ensureConversationForCustomer(conv.customerId);
    if (primary.id !== conv.id) {
      conv = await prisma.conversation.findUnique({
        where: { id: primary.id },
        include: { customer: true },
      });
      if (!conv) {
        return res.status(404).json({ detail: "Conversation not found" });
      }
    }

    const messagesRaw = await prisma.whatsappMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: "asc" },
    });

    const seenIds = new Set<string>();
    const seenWaIds = new Set<string>();
    const messages = messagesRaw.filter((m) => {
      if (seenIds.has(m.id)) return false;
      seenIds.add(m.id);
      if (m.waMessageId) {
        if (seenWaIds.has(m.waMessageId)) return false;
        seenWaIds.add(m.waMessageId);
      }
      return true;
    });

    const session = await getConversationSessionState(conv.id);

    return res.json({
      conversation: {
        id: conv.id,
        customerId: conv.customerId,
        waConversationId: conv.waConversationId,
        status: conv.status,
        lastMessageAt: conv.lastMessageAt.toISOString(),
        createdAt: conv.createdAt.toISOString(),
        lastInboundAt: session.lastInboundAt?.toISOString() ?? null,
        sessionOpen: session.sessionOpen,
        sessionExpiresAt: session.expiresAt?.toISOString() ?? null,
        redirectedFrom: primary.id !== requestedId ? requestedId : undefined,
      },
      customer: conv.customer,
      messages,
    });
  } catch (error) {
    logger.error(`Error fetching conversation ${conversationId}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function sendConversationMessage(req: Request, res: Response) {
  const { conversationId } = req.params;
  const text = String(req.body?.text || "").trim();

  if (!text) {
    return res.status(400).json({ detail: "Message text is required" });
  }
  if (text.length > 4000) {
    return res.status(400).json({ detail: "Message is too long (max 4000 characters)" });
  }

  try {
    let conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { customer: true },
    });

    if (!conv) {
      return res.status(404).json({ detail: "Conversation not found" });
    }

    const primary = await ensureConversationForCustomer(conv.customerId);
    if (primary.id !== conv.id) {
      conv = await prisma.conversation.findUnique({
        where: { id: primary.id },
        include: { customer: true },
      });
      if (!conv) {
        return res.status(404).json({ detail: "Conversation not found" });
      }
    }

    const session = await getConversationSessionState(conv.id);
    if (!session.sessionOpen) {
      return res.status(403).json({
        detail:
          "Chat is closed. Custom messages can only be sent within 24 hours of the customer's last message. Use a template instead.",
        sessionOpen: false,
        lastInboundAt: session.lastInboundAt?.toISOString() ?? null,
      });
    }

    const messageId = await sendTextMessage(conv.customer.phone, text, conv.id);
    const message = await prisma.whatsappMessage.findUnique({ where: { id: messageId } });

    return res.status(201).json({
      ok: true,
      messageId,
      message,
      conversationId: conv.id,
      sessionOpen: true,
      sessionExpiresAt: session.expiresAt?.toISOString() ?? null,
    });
  } catch (error: any) {
    logger.error(`Error sending conversation message ${conversationId}: ${error?.message || error}`);
    return res.status(500).json({ detail: error?.message || "Failed to send message" });
  }
}
