import { prisma } from "../lib/prisma";

export const WHATSAPP_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function getLastInboundAt(conversationId: string): Promise<Date | null> {
  const lastInbound = await prisma.whatsappMessage.findFirst({
    where: { conversationId, direction: "INBOUND" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return lastInbound?.createdAt ?? null;
}

export function isWithinSessionWindow(lastInboundAt: Date | null, now = new Date()): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < WHATSAPP_SESSION_WINDOW_MS;
}

export async function getConversationSessionState(conversationId: string) {
  const lastInboundAt = await getLastInboundAt(conversationId);
  const sessionOpen = isWithinSessionWindow(lastInboundAt);
  const expiresAt =
    lastInboundAt && sessionOpen
      ? new Date(lastInboundAt.getTime() + WHATSAPP_SESSION_WINDOW_MS)
      : null;

  return {
    lastInboundAt,
    sessionOpen,
    expiresAt,
  };
}
