import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { logger } from "../../utils/logger";

export async function listWhatsappDeliveryLogs(req: Request, res: Response) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const status = typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "";
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";

    const where: Record<string, unknown> = {
      direction: "OUTBOUND",
    };

    if (status && status !== "all") {
      where.deliveryStatus = status;
    }

    if (q) {
      where.OR = [
        { content: { contains: q, mode: "insensitive" } },
        { templateName: { contains: q, mode: "insensitive" } },
        { waMessageId: { contains: q, mode: "insensitive" } },
        { msg91RequestId: { contains: q, mode: "insensitive" } },
        { failureReason: { contains: q, mode: "insensitive" } },
        { conversation: { customer: { phone: { contains: q } } } },
        { conversation: { customer: { name: { contains: q, mode: "insensitive" } } } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.whatsappMessage.count({ where: where as any }),
      prisma.whatsappMessage.findMany({
        where: where as any,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        include: {
          conversation: {
            include: {
              customer: {
                select: { id: true, name: true, phone: true },
              },
            },
          },
        },
      }),
    ]);

    const items = rows.map((msg) => ({
      id: msg.id,
      conversationId: msg.conversationId,
      type: msg.type,
      content: msg.content,
      templateName: msg.templateName,
      deliveryStatus: msg.deliveryStatus,
      failureReason: msg.failureReason,
      waMessageId: msg.waMessageId,
      msg91RequestId: msg.msg91RequestId,
      mediaUrl: msg.mediaUrl,
      createdAt: msg.createdAt.toISOString(),
      statusUpdatedAt: msg.statusUpdatedAt?.toISOString() || null,
      customer: msg.conversation.customer
        ? {
            id: msg.conversation.customer.id,
            name: msg.conversation.customer.name,
            phone: msg.conversation.customer.phone,
          }
        : null,
    }));

    return res.json({
      items,
      total,
      limit,
      offset,
    });
  } catch (error) {
    logger.error("Error listing WhatsApp delivery logs: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}
