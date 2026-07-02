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

  await redisConnection.setex(`ocr:job:${jobId}`, 3600, JSON.stringify(jobState));
  return jobId;
}
