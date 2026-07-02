import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { logger } from "../../utils/logger";

export async function listNotifications(req: Request, res: Response) {
  try {
    const items = await prisma.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return res.json({ items });
  } catch (error) {
    logger.error("Error listing notifications: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function markAsRead(req: Request, res: Response) {
  const { id } = req.params;
  try {
    const updated = await prisma.notification.update({
      where: { id },
      data: { read: true },
    });
    return res.json(updated);
  } catch (error) {
    logger.error("Error marking notification as read: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function readAll(req: Request, res: Response) {
  try {
    await prisma.notification.updateMany({
      where: { read: false },
      data: { read: true },
    });
    return res.json({ ok: true });
  } catch (error) {
    logger.error("Error marking all notifications as read: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}
