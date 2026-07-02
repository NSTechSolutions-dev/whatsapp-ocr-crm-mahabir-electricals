import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { prisma } from "../lib/prisma";
import { runQuotationPipeline } from "../services/quotation-pipeline.service";
import { ProductExtractionError } from "../services/product-extraction.service";
import { GeminiApiError } from "../lib/gemini-retry";
import { createSystemNotification } from "../utils/notification";
import { logger } from "../utils/logger";

export const inventoryScoreWorker = new Worker(
  "inventoryScoreQueue",
  async (job) => {
    const { rawText, ocrConfidence, conversationId, customerId, jobId, source, messageId, msgType } = job.data;

    const logPrefix = source ? `[${source}]` : "";
    const id = jobId || messageId;
    logger.info(`${logPrefix} inventoryScoreWorker starting job ${id} (${msgType || "unknown"})`);

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
      const textForPipeline = rawText?.trim() || "";
      let pipelineResult;
      try {
        pipelineResult = textForPipeline
          ? await runQuotationPipeline(textForPipeline)
          : {
              matchedRows: [],
              quotation: { lines: [], subtotal: 0, grandTotal: 0 },
              stats: {
                extracted: 0,
                cacheHits: 0,
                sqlMatches: 0,
                aiVerified: 0,
                unmatched: 0,
                embeddingMatches: 0,
                embeddingApiCalls: 0,
                learningHits: 0,
              },
            };
      } catch (pipelineError: any) {
        const retryable =
          pipelineError instanceof GeminiApiError
            ? pipelineError.retryable
            : pipelineError instanceof ProductExtractionError
              ? pipelineError.retryable
              : true;
        await updateJobState("failed", {
          status: "failed",
          failedStep: "inventory_score",
          error: pipelineError?.message || "Gemini processing failed",
          retryable,
          rawText,
          ocrConfidence,
        });
        logger.error(`${logPrefix} Pipeline failed for job ${id}: ${pipelineError?.message}`);
        return;
      }

      const matchedItems = pipelineResult.matchedRows;

      const isInventoryRelated = matchedItems.length > 0;

      logger.info(
        `${logPrefix} Job ${id}: items=${matchedItems.length}, pipeline=${JSON.stringify(pipelineResult.stats)}`
      );

      // Resolve customer
      let resolvedCustomerId = customerId;
      let resolvedConversationId = conversationId;

      if (!resolvedCustomerId && resolvedConversationId) {
        const conversation = await prisma.conversation.findUnique({
          where: { id: resolvedConversationId },
          select: { customerId: true },
        });
        if (conversation) {
          resolvedCustomerId = conversation.customerId;
        }
      }

      if (!resolvedCustomerId) {
        throw new Error(`No customerId available for job ${id}`);
      }

      const adminUser = await prisma.user.findFirst({
        where: { role: "ADMIN", isActive: true },
      });

      if (!adminUser) {
        throw new Error("No active ADMIN user found to assign enquiry creation");
      }

      // Not inventory-related or no products extracted → IGNORED enquiry
      if (!isInventoryRelated || matchedItems.length === 0) {
        const enquiry = await prisma.enquiry.create({
          data: {
            conversationId: resolvedConversationId,
            customerId: resolvedCustomerId,
            createdById: adminUser.id,
            status: "IGNORED",
            sourceData: rawText || textForPipeline || null,
          },
        });

        logger.info(`${logPrefix} Created IGNORED enquiry ${enquiry.id} (not inventory-related)`);

        await updateJobState("done", {
          enquiryId: enquiry.id,
          status: "done",
          ignored: true,
          rawText,
          ocrConfidence,
        });

        await createSystemNotification(
          "Message Ignored",
          `Inbound message was not an inventory enquiry. Enquiry ID: ${enquiry.id}`,
          "info"
        );

        return;
      }

      // Create DRAFT Enquiry with matched items
      const enquiry = await prisma.enquiry.create({
        data: {
          conversationId: resolvedConversationId,
          customerId: resolvedCustomerId,
          createdById: adminUser.id,
          status: "DRAFT",
          sourceData: rawText,
        },
      });

      await prisma.enquiryItem.createMany({
        data: matchedItems.map((item) => ({
          enquiryId: enquiry.id,
          inventoryId: item.inventoryId,
          autoInventoryId: item.inventoryId,
          productName: item.matchedName || item.product,
          qty: item.qty,
          unit: item.unit || "Pcs",
          rate: item.rate,
          confidence: item.confidence,
          rawText: item.raw,
        })),
      });

      logger.info(`${logPrefix} Created DRAFT enquiry ${enquiry.id} with ${matchedItems.length} items (subtotal=${pipelineResult.quotation.subtotal})`);

      await updateJobState("done", {
        enquiryId: enquiry.id,
        status: "done",
        rows: matchedItems,
        quotation: pipelineResult.quotation,
        rawText,
        ocrConfidence,
      });

      await createSystemNotification(
        "New Enquiry Drafted",
        `A new enquiry has been drafted. Customer ID: ${resolvedCustomerId}, Enquiry ID: ${enquiry.id}`,
        "info"
      );

      logger.info(`${logPrefix} Successfully completed inventory scoring for job ${id}, enquiry ${enquiry.id}`);
    } catch (error: any) {
      logger.error(`${logPrefix} inventoryScoreWorker failed job ${id}: ${error}`);
      const retryable = error instanceof GeminiApiError ? error.retryable : true;
      await updateJobState("failed", {
        status: "failed",
        failedStep: "inventory_score",
        error: error.message || "Unknown error occurred",
        retryable,
        rawText,
        ocrConfidence,
      });
      return;
    }
  },
  {
    connection: redisConnection,
    concurrency: 2,
    limiter: { max: 2, duration: 1000 },
  }
);
