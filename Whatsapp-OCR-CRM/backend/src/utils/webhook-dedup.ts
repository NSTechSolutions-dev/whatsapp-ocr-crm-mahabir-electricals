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

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/** MSG91 often sends `messages` as a JSON string, not an array. */
function firstInboundMessage(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const raw = payload.messages;
  let list: unknown[] | undefined;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === "string" && raw.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = undefined;
    }
  }
  return asRecord(list?.[0]) ?? asRecord(payload.message);
}

function extractInboundText(nested: Record<string, unknown> | undefined): string | null {
  const text = nested?.text;
  if (typeof text === "string" && text.trim()) return text.trim();
  const body = asRecord(text)?.body;
  if (typeof body === "string" && body.trim()) return body.trim();
  const content = nested?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  return null;
}

function extractInboundMediaUrl(nested: Record<string, unknown> | undefined): string | null {
  const image = asRecord(nested?.image);
  return firstNonEmpty(image?.url, nested?.url, nested?.mediaUrl);
}

export function parseMsg91Inbound(payload: Record<string, unknown>): ParsedMsg91Inbound {
  const nested = firstInboundMessage(payload);

  const phone = firstNonEmpty(
    payload.customerNumber,
    payload.from,
    payload.phone,
    payload.sender,
    nested?.from
  );

  const msgType = String(
    payload.contentType || payload.messageType || payload.type || nested?.type || "text"
  ).toLowerCase();

  const name = firstNonEmpty(payload.customerName, payload.name, nested?.name);

  const content = firstNonEmpty(
    payload.text,
    payload.content,
    payload.body,
    extractInboundText(nested)
  );

  const sourceMediaUrl = firstNonEmpty(
    payload.url,
    payload.mediaUrl,
    extractInboundMediaUrl(nested)
  );

  const waMessageId = firstNonEmpty(
    payload.uuid,
    payload.messageId,
    payload.message_id,
    nested?.uuid,
    nested?.messageId,
    nested?.id
  );

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
