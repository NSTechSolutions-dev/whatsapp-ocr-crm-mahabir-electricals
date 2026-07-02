import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { logger } from "../../utils/logger";

export async function listConversations(req: Request, res: Response) {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const q = (req.query.q as string || "").toLowerCase();
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
        unreadCount: 0, // In postgres schema there is no unreadCount on conversation, so we return 0 or calculate if needed
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

    const messages = await prisma.whatsappMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });

    // Mark as read or reset unread if any counter existed. In our model we don't have it on Postgres, so no-op is fine.

    return res.json({
      conversation: {
        id: conv.id,
        customerId: conv.customerId,
        waConversationId: conv.waConversationId,
        status: conv.status,
        lastMessageAt: conv.lastMessageAt.toISOString(),
        createdAt: conv.createdAt.toISOString(),
      },
      customer: conv.customer,
      messages,
    });
  } catch (error) {
    logger.error(`Error fetching conversation ${conversationId}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}
