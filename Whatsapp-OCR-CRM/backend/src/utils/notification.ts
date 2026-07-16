import { prisma } from "../lib/prisma";
import { Server } from "socket.io";
import { logger } from "./logger";

let ioInstance: Server | null = null;

export function setIo(io: Server) {
  ioInstance = io;
}

export function getIo(): Server | null {
  return ioInstance;
}

export async function createSystemNotification(title: string, message: string, type: string = "low_stock") {
  try {
    const notification = await prisma.notification.create({
      data: {
        title,
        message,
        type,
      },
    });

    if (ioInstance) {
      ioInstance.emit("notification", notification);
      logger.info(`Broadcasted notification over socket: ${title}`);
    }

    return notification;
  } catch (error) {
    logger.error("Error creating system notification: " + error);
    return null;
  }
}
