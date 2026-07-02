import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { logger } from "../utils/logger";
import { ocrQueue } from "./queues";

export const inboundWorker = new Worker(
  "inboundQueue",
  async (job) => {
    const { messageId, msgType, content, mediaUrl, customerId, conversationId, jobId, source } = job.data;
    
    const sourceLabel = source || (jobId ? "staff_upload" : "webhook");
    logger.info(`[${sourceLabel}] inboundWorker received message ${messageId || jobId} from customer ${customerId}`);

    try {
      // If this is a staff upload (has jobId), update Redis step to "ocr"
      if (jobId) {
        const state = await redisConnection.get(`ocr:job:${jobId}`);
        if (state) {
          const parsed = JSON.parse(state);
          await redisConnection.setex(
            `ocr:job:${jobId}`,
            3600,
            JSON.stringify({ ...parsed, step: "ocr" })
          );
        }
      }

      // Route to ocrQueue for OCR processing
      await ocrQueue.add("processMessage", {
        messageId,
        msgType,
        content,
        mediaUrl,
        customerId,
        conversationId,
        jobId,
        source: sourceLabel,
      });

      logger.info(`[${sourceLabel}] Successfully routed to ocrQueue`);
    } catch (error) {
      logger.error(`[${sourceLabel}] Error in inboundWorker for message ${messageId || jobId}: ${error}`);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 5,
  }
);
