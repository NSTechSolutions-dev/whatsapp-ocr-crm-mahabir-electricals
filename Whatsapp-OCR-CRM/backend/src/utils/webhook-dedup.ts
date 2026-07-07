import crypto from "crypto";
import { redisConnection } from "../lib/redis";
import { logger } from "./logger";
import { normalizePhone } from "./phone";

const DEDUP_TTL_SECONDS = 180;
const BURST_TTL_SECONDS = 4;

export interface ParsedMsg91Inbound {
  phone: string | null;
  msgType: string;
  name: string | null;
  content: string | null;
  sourceMediaUrl: string | null;
  waMessageId: string | null;
}

export function normalizeMessageContent(content: string | null): string {
  if (!content) return "";
  return content.replace(/\s+/g, " ").trim();
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

export function buildInboundFingerprint(input: {
  phone: string;
  msgType: string;
  content: string | null;
  sourceMediaUrl: string | null;
}): string {
  const parts = [
    normalizePhone(input.phone),
    input.msgType.toLowerCase(),
    normalizeMessageContent(input.content),
    input.sourceMediaUrl?.trim() || "",
  ];
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

export function collectInboundDedupeKeys(input: {
  waMessageId: string | null;
  phone: string;
  msgType: string;
  content: string | null;
  sourceMediaUrl: string | null;
  rawBody?: Buffer | string;
}): string[] {
  const keys: string[] = [];
  if (input.waMessageId) {
    keys.push(`wa:${input.waMessageId}`);
  }
  keys.push(`fp:${buildInboundFingerprint(input)}`);
  keys.push(`burst:${normalizePhone(input.phone)}`);
  if (input.rawBody) {
    const raw =
      typeof input.rawBody === "string" ? input.rawBody : input.rawBody.toString("utf8");
    const rawHash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24);
    keys.push(`raw:${rawHash}`);
  }
  return keys;
}

export async function claimInboundDedup(keys: string[]): Promise<boolean> {
  try {
    for (const key of keys) {
      const exists = await redisConnection.get(`inbound:dedup:${key}`);
      if (exists) {
        logger.info(`Inbound dedup hit existing key: ${key}`);
        return false;
      }
    }

    const pipeline = redisConnection.pipeline();
    for (const key of keys) {
      const ttl = key.startsWith("burst:") ? BURST_TTL_SECONDS : DEDUP_TTL_SECONDS;
      pipeline.set(`inbound:dedup:${key}`, "1", "EX", ttl, "NX");
    }
    const results = await pipeline.exec();

    for (const entry of results || []) {
      const err = entry[0];
      const result = entry[1];
      if (err || result !== "OK") {
        logger.info(`Inbound dedup lost race on key set`);
        return false;
      }
    }
    return true;
  } catch (error) {
    logger.error(`Redis dedup claim failed: ${error}`);
    return true;
  }
}
