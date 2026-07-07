import crypto from "crypto";
import { redisConnection } from "../lib/redis";
import { logger } from "./logger";
import { normalizePhone } from "./phone";

const DEDUP_TTL_SECONDS = 180;

export interface ParsedMsg91Inbound {
  phone: string | null;
  msgType: string;
  name: string | null;
  content: string | null;
  sourceMediaUrl: string | null;
  waMessageId: string | null;
}

export function parseMsg91Inbound(payload: Record<string, unknown>): ParsedMsg91Inbound {
  const messages = Array.isArray(payload.messages) ? payload.messages : undefined;
  const nested = (messages?.[0] ?? payload.message) as Record<string, unknown> | undefined;

  const phone =
    (payload.customerNumber as string) ||
    (payload.from as string) ||
    (payload.phone as string) ||
    (payload.sender as string) ||
    (nested?.from as string) ||
    null;

  const msgType = String(
    payload.contentType || payload.messageType || payload.type || nested?.type || "text"
  ).toLowerCase();

  const name =
    (payload.customerName as string) ||
    (payload.name as string) ||
    (nested?.name as string) ||
    null;

  const content =
    (payload.text as string) ||
    (payload.content as string) ||
    (payload.body as string) ||
    (nested?.text as string) ||
    (nested?.content as string) ||
    null;

  const sourceMediaUrl =
    (payload.url as string) ||
    (payload.mediaUrl as string) ||
    (nested?.url as string) ||
    (nested?.mediaUrl as string) ||
    null;

  const waMessageId =
    (payload.uuid as string) ||
    (payload.messageId as string) ||
    (payload.message_id as string) ||
    (nested?.uuid as string) ||
    (nested?.messageId as string) ||
    (nested?.id as string) ||
    null;

  return { phone, msgType, name, content, sourceMediaUrl, waMessageId };
}

export function buildInboundWebhookDedupeKey(input: {
  waMessageId: string | null;
  phone: string;
  msgType: string;
  content: string | null;
  sourceMediaUrl: string | null;
}): string {
  const phone = normalizePhone(input.phone);

  if (input.waMessageId) {
    return `wa:${input.waMessageId}`;
  }

  const normalizedContent = input.content?.trim();
  if (normalizedContent) {
    const hash = crypto.createHash("sha256").update(normalizedContent).digest("hex").slice(0, 20);
    return `text:${phone}:${input.msgType}:${hash}`;
  }

  if (input.sourceMediaUrl) {
    const hash = crypto.createHash("sha256").update(input.sourceMediaUrl).digest("hex").slice(0, 20);
    return `media:${phone}:${input.msgType}:${hash}`;
  }

  return `unknown:${phone}:${input.msgType}:${crypto.randomUUID()}`;
}

export async function claimInboundWebhook(dedupeKey: string): Promise<boolean> {
  const redisKey = `inbound:dedup:${dedupeKey}`;
  try {
    const result = await redisConnection.set(redisKey, "1", "EX", DEDUP_TTL_SECONDS, "NX");
    return result === "OK";
  } catch (error) {
    logger.error(`Redis dedup claim failed for ${dedupeKey}: ${error}`);
    return true;
  }
}
