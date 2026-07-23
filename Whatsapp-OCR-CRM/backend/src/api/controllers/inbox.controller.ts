import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { logger } from "../../utils/logger";
import { sendTextMessage } from "../../services/whatsapp.service";
import { getConversationSessionState } from "../../utils/whatsapp-session";

export async function listConversations(req: Request, res: Response) {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const q = ((req.query.q as string) || "").toLowerCase();
  const skip = (page - 1) * limit;

  try {
    const convs = await prisma.conversation.findMany({
      orderBy: { lastMessageAt: "desc" },
      skip,
      take: limit,
      include: {
        customer: true,
      },
    });

    const enriched = [];
    for (const c of convs) {
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
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        customer: true,
      },
    });

    if (!conv) {
      return res.status(404).json({ detail: "Conversation not found" });
    }

    const messagesRaw = await prisma.whatsappMessage.findMany({
      where: { conversationId },
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

    const session = await getConversationSessionState(conversationId);

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
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { customer: true },
    });

    if (!conv) {
      return res.status(404).json({ detail: "Conversation not found" });
    }

    const session = await getConversationSessionState(conversationId);
    if (!session.sessionOpen) {
      return res.status(403).json({
        detail:
          "Chat is closed. Custom messages can only be sent within 24 hours of the customer's last message. Use a template instead.",
        sessionOpen: false,
        lastInboundAt: session.lastInboundAt?.toISOString() ?? null,
      });
    }

    const messageId = await sendTextMessage(conv.customer.phone, text, conversationId);
    const message = await prisma.whatsappMessage.findUnique({ where: { id: messageId } });

    return res.status(201).json({
      ok: true,
      messageId,
      message,
      sessionOpen: true,
      sessionExpiresAt: session.expiresAt?.toISOString() ?? null,
    });
  } catch (error: any) {
    logger.error(`Error sending conversation message ${conversationId}: ${error?.message || error}`);
    return res.status(500).json({ detail: error?.message || "Failed to send message" });
  }
}
