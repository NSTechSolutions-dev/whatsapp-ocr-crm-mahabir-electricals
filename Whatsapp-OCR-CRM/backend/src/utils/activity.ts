import { prisma } from "../lib/prisma";
import { logger } from "./logger";

export async function logActivity(userId: string, action: string, entityType: string, entityId: string) {
  if (!userId) return;
  try {
    await prisma.activityLog.create({
      data: {
        userId,
        action,
        entityType,
        entityId,
      },
    });
  } catch (error) {
    logger.error("Failed to log activity: " + error);
  }
}
