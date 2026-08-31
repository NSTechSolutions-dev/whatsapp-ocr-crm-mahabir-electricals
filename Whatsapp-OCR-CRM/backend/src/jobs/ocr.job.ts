import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { getBuffer } from "../lib/s3";
import { detectDocumentText } from "../lib/gcv";
import { GeminiApiError } from "../lib/gemini-retry";
import { isOcrJobCancelled } from "../lib/ocr-job-state";
import { formatUserErrorMessage } from "../utils/user-error-message";
import { logger } from "../utils/logger";
import { inventoryScoreQueue, ocrQueue } from "./queues";
import {
  scheduleAutoRetry,
  clearAutoRetry,
  GEMINI_RETRY_DELAY_MS,
} from "./gemini-auto-retry";

export const ocrWorker = new Worker(
  "ocrQueue",
  async (job) => {
    const { messageId, msgType, content, mediaUrl, customerId, conversationId, jobId, source, s3Key } = job.data;

    const logPrefix = source ? `[${source}]` : "";
    const id = jobId || messageId;
    logger.info(`${logPrefix} ocrWorker starting job ${id}`);

    const scopeKey = jobId || (messageId ? `msg:${messageId}` : null);

    if (jobId && (await isOcrJobCancelled(jobId))) {
      logger.info(`${logPrefix} Skipping cancelled OCR job ${jobId}`);
      return;
    }

    const updateJobState = async (step: string, extra = {}) => {
      if (!jobId) return;
      const state = await redisConnection.get(`ocr:job:${jobId}`);
      if (state) {
        const parsed = JSON.parse(state);
        await redisConnection.setex(
          `ocr:job:${jobId}`,
          3600,
          JSON.stringify({ ...parsed, step, ...extra })
        );
      }
    };

    try {
      await updateJobState("ocr");

      let rawText = "";
      let ocrConfidence = 1.0;

      if (msgType === "text" && content) {
        rawText = content;
        ocrConfidence = 1.0;
        logger.info(`${logPrefix} Text message for job ${id}: ${rawText.length} chars`);
      } else if (msgType === "image" && mediaUrl) {
        const buffer = await getBuffer(mediaUrl);
        const ocrResult = await detectDocumentText(buffer);
        rawText = ocrResult.fullText;
        ocrConfidence = ocrResult.averageConfidence;
      } else if (s3Key) {
        const buffer = await getBuffer(s3Key);
        const ocrResult = await detectDocumentText(buffer);
        rawText = ocrResult.fullText;
        ocrConfidence = ocrResult.averageConfidence;
      }

      logger.info(`${logPrefix} OCR complete for job ${id}: ${rawText.length} chars transcribed`);

      await updateJobState("inventory_score", { rawText, ocrConfidence });

      await clearAutoRetry(scopeKey);

      await inventoryScoreQueue.add("scoreProducts", {
        rawText,
        ocrConfidence,
        conversationId,
        customerId,
        jobId,
        source,
        messageId,
        msgType: msgType || "image",
      });

      logger.info(`${logPrefix} Routed to inventoryScoreQueue (${rawText.length} chars)`);
    } catch (error: any) {
      logger.error(`${logPrefix} ocrWorker failed job ${id}: ${error}`);
      const geminiError = error instanceof GeminiApiError ? error : null;
      const retryable = geminiError?.retryable ?? true;
      await updateJobState("failed", {
        status: "failed",
        failedStep: "ocr",
        error: formatUserErrorMessage(error, "Gemini OCR failed. Please try again."),
        retryable,
      });

      try {
        await scheduleAutoRetry({
          scopeKey: scopeKey || `unknown:${id}`,
          retryable,
          add: (attempt) =>
            ocrQueue.add(
              "processMessage",
              {
                messageId,
                msgType,
                content,
                mediaUrl,
                customerId,
                conversationId,
                jobId,
                source,
                s3Key,
              },
              {
                jobId: `${jobId ? `ocr-${jobId}` : `ocr-msg-${messageId}`}-retry-${attempt}`,
                delay: GEMINI_RETRY_DELAY_MS,
                attempts: 1,
                removeOnComplete: true,
                removeOnFail: 100,
              }
            ),
        });
      } catch (retryError) {
        logger.error(`${logPrefix} Failed to schedule Gemini auto-retry for job ${id}: ${retryError}`);
      }
      return;
    }
  },
  {
    connection: redisConnection,
    concurrency: 2,
  }
);
