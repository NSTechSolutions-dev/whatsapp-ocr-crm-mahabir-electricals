import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { prisma } from "../lib/prisma";
import { getBuffer } from "../lib/s3";
import { detectDocumentText } from "../lib/gcv";
import { inventoryScoreQueue } from "./queues";
import {
  claimWaitingEnquiry,
  markEnquiryFailed,
} from "../services/inquiry-grouping.service";
import { formatUserErrorMessage } from "../utils/user-error-message";
import { logger } from "../utils/logger";
import { getIo } from "../utils/notification";

async function mergeImageOcr(enquiryId: string): Promise<{ rawText: string; ocrConfidence: number }> {
  const images = await prisma.enquiryImage.findMany({
    where: { enquiryId },
    orderBy: [{ pageNumber: "asc" }, { uploadedAt: "asc" }],
  });

  if (images.length === 0) {
    throw new Error("No images attached to enquiry");
  }

  const parts: string[] = [];
  let totalConfidence = 0;

  for (const img of images) {
    const buffer = await getBuffer(img.imageUrl);
    const ocrResult = await detectDocumentText(buffer);
    totalConfidence += ocrResult.averageConfidence;
    parts.push(`--- Page ${img.pageNumber} ---\n${ocrResult.fullText}`);
  }

  const rawText = parts.join("\n\n");
  const ocrConfidence = totalConfidence / images.length;

  return { rawText, ocrConfidence };
}

export const inquiryBatchWorker = new Worker(
  "inquiryBatchQueue",
  async (job) => {
    const { enquiryId } = job.data as { enquiryId: string };
    logger.info(`inquiryBatchWorker processing enquiry ${enquiryId}`);

    const enquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
      select: {
        id: true,
        status: true,
        conversationId: true,
        customerId: true,
        processAt: true,
      },
    });

    if (!enquiry) {
      logger.warn(`inquiryBatchWorker: enquiry ${enquiryId} not found`);
      return;
    }

    if (enquiry.status === "WAITING") {
      const claimed = await claimWaitingEnquiry(enquiryId);
      if (!claimed) {
        logger.info(`inquiryBatchWorker: enquiry ${enquiryId} already claimed or not ready`);
        return;
      }
      const io = getIo();
      if (io) {
        io.to(`conversation:${enquiry.conversationId}`).emit("enquiry_updated", {
          enquiryId,
          status: "PROCESSING",
        });
      }
    } else if (enquiry.status !== "PROCESSING") {
      logger.info(`inquiryBatchWorker: enquiry ${enquiryId} status=${enquiry.status}, skipping`);
      return;
    }

    try {
      const { rawText, ocrConfidence } = await mergeImageOcr(enquiryId);

      await inventoryScoreQueue.add(
        "scoreProducts",
        {
          rawText,
          ocrConfidence,
          conversationId: enquiry.conversationId,
          customerId: enquiry.customerId,
          enquiryId,
          source: "whatsapp_batch",
          msgType: "image",
        },
        {
          jobId: `inventory-batch-${enquiryId}`,
          removeOnComplete: true,
          removeOnFail: 50,
        }
      );

      logger.info(
        `inquiryBatchWorker: enqueued inventory score for enquiry ${enquiryId} (${rawText.length} chars)`
      );
    } catch (error: any) {
      const message = formatUserErrorMessage(error, "Batch OCR failed. Please try again.");
      logger.error(`inquiryBatchWorker failed for enquiry ${enquiryId}: ${error}`);
      await markEnquiryFailed(enquiryId, message);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 2,
  }
);
