import crypto from "crypto";
import { redisConnection } from "./redis";

export interface OcrJobStateInput {
  conversationId: string;
  customerId?: string;
  messageId?: string;
  msgType: string;
  mediaUrl?: string | null;
  source: "webhook" | "staff_upload";
}

const JOB_KEY_PREFIX = "ocr:job:";
const STALE_JOB_MS = 20 * 60 * 1000;

async function scanJobKeys(): Promise<string[]> {
  const jobKeys: string[] = [];
  let cursor = "0";

  do {
    const [nextCursor, keys] = await redisConnection.scan(
      cursor,
      "MATCH",
      `${JOB_KEY_PREFIX}*`,
      "COUNT",
      100
    );
    cursor = nextCursor;
    jobKeys.push(...keys);
  } while (cursor !== "0");

  return jobKeys;
}

export async function createOcrJobState(input: OcrJobStateInput): Promise<string> {
  const jobId = crypto.randomUUID();
  const jobState = {
    status: "processing",
    step: "queued",
    conversationId: input.conversationId,
    customerId: input.customerId || null,
    messageId: input.messageId || null,
    msgType: input.msgType,
    mediaUrl: input.mediaUrl || null,
    s3Key: input.mediaUrl || null,
    source: input.source,
    createdAt: new Date().toISOString(),
    userId: null,
  };

  await redisConnection.setex(`${JOB_KEY_PREFIX}${jobId}`, 3600, JSON.stringify(jobState));
  return jobId;
}

export async function findActiveJobForMessage(messageId: string): Promise<string | null> {
  const jobKeys = await scanJobKeys();

  for (const key of jobKeys) {
    const state = await redisConnection.get(key);
    if (!state) continue;

    const parsed = JSON.parse(state);
    if (parsed.messageId === messageId && parsed.status === "processing") {
      return key.replace(JOB_KEY_PREFIX, "");
    }
  }

  return null;
}

export async function isOcrJobCancelled(jobId: string): Promise<boolean> {
  const state = await redisConnection.get(`${JOB_KEY_PREFIX}${jobId}`);
  if (!state) return false;
  const parsed = JSON.parse(state);
  return parsed.status === "cancelled";
}

export async function cancelConversationJobs(conversationId: string): Promise<number> {
  const jobKeys = await scanJobKeys();
  let cancelled = 0;

  for (const key of jobKeys) {
    const state = await redisConnection.get(key);
    if (!state) continue;

    const parsed = JSON.parse(state);
    if (parsed.conversationId !== conversationId) continue;
    if (!["processing", "failed", "cancelled"].includes(parsed.status)) continue;

    await redisConnection.del(key);
    cancelled += 1;
  }

  return cancelled;
}

export async function markStaleJobsFailed(conversationId?: string): Promise<number> {
  const jobKeys = await scanJobKeys();
  let updated = 0;
  const now = Date.now();

  for (const key of jobKeys) {
    const state = await redisConnection.get(key);
    if (!state) continue;

    const parsed = JSON.parse(state);
    if (conversationId && parsed.conversationId !== conversationId) continue;
    if (parsed.status !== "processing" || !parsed.createdAt) continue;

    const age = now - new Date(parsed.createdAt).getTime();
    if (age <= STALE_JOB_MS) continue;

    await redisConnection.setex(
      key,
      3600,
      JSON.stringify({
        ...parsed,
        status: "failed",
        step: parsed.step || "failed",
        error: "Processing timed out. Retry when Gemini is available.",
        retryable: true,
        failedStep: parsed.step === "inventory_score" ? "inventory_score" : "ocr",
      })
    );
    updated += 1;
  }

  return updated;
}
