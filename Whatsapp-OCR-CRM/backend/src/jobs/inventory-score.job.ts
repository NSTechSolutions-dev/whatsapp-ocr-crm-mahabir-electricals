import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { prisma } from "../lib/prisma";
import { runQuotationPipeline } from "../services/quotation-pipeline.service";
import { ProductExtractionError } from "../services/product-extraction.service";
import { GeminiApiError } from "../lib/gemini-retry";
import { isOcrJobCancelled } from "../lib/ocr-job-state";
import { markEnquiryFailed } from "../services/inquiry-grouping.service";
import { reactivateLostCustomer } from "../services/automation-guard.service";
import { createSystemNotification } from "../utils/notification";
import { formatUserErrorMessage } from "../utils/user-error-message";
import { logger } from "../utils/logger";
import { getIo } from "../utils/notification";

function emitEnquiryUpdate(conversationId: string, payload: Record<string, unknown>) {
  const io = getIo();
  if (!io) return;
  io.to(`conversation:${conversationId}`).emit("enquiry_updated", payload);
}

export const inventoryScoreWorker = new Worker(
  "inventoryScoreQueue",
  async (job) => {
    const {
      rawText,
      ocrConfidence,
      conversationId,
      customerId,
      jobId,
      source,
      messageId,
      msgType,
      enquiryId: existingEnquiryId,
    } = job.data;

    const logPrefix = source ? `[${source}]` : "";
    const id = jobId || messageId || existingEnquiryId;
    logger.info(`${logPrefix} inventoryScoreWorker starting job ${id} (${msgType || "unknown"})`);

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
        const errorMsg = formatUserErrorMessage(
          pipelineError,
          "Gemini processing failed. Please try again."
        );

        if (existingEnquiryId) {
          await markEnquiryFailed(existingEnquiryId, errorMsg);
          const enq = await prisma.enquiry.findUnique({
            where: { id: existingEnquiryId },
            select: { conversationId: true },
          });
          if (enq) {
            emitEnquiryUpdate(enq.conversationId, {
              enquiryId: existingEnquiryId,
              status: "FAILED",
              processingError: errorMsg,
            });
          }
        }

        await updateJobState("failed", {
          status: "failed",
          failedStep: "inventory_score",
          error: errorMsg,
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

      await reactivateLostCustomer(resolvedCustomerId);

      const adminUser = await prisma.user.findFirst({
        where: { role: "ADMIN", isActive: true },
      });

      if (!adminUser) {
        throw new Error("No active ADMIN user found to assign enquiry creation");
      }

      const itemRows = matchedItems.map((item) => ({
        inventoryId: item.inventoryId,
        autoInventoryId: item.inventoryId,
        productName: item.matchedName || item.product,
        qty: item.qty,
        unit: item.unit || "Pcs",
        rate: item.rate,
        confidence: item.confidence,
        rawText: item.raw,
      }));

      if (!isInventoryRelated || matchedItems.length === 0) {
        let enquiry: { id: string; conversationId: string };

        if (existingEnquiryId) {
          enquiry = await prisma.enquiry.update({
            where: { id: existingEnquiryId },
            data: {
              status: "IGNORED",
              sourceData: rawText || textForPipeline || null,
              processingError: null,
            },
          });
          await prisma.enquiryItem.deleteMany({ where: { enquiryId: existingEnquiryId } });
        } else {
          enquiry = await prisma.enquiry.create({
            data: {
              conversationId: resolvedConversationId,
              customerId: resolvedCustomerId,
              createdById: adminUser.id,
              status: "IGNORED",
              sourceData: rawText || textForPipeline || null,
            },
          });
        }

        logger.info(`${logPrefix} ${existingEnquiryId ? "Updated" : "Created"} IGNORED enquiry ${enquiry.id}`);

        emitEnquiryUpdate(enquiry.conversationId, {
          enquiryId: enquiry.id,
          status: "IGNORED",
          itemsCount: 0,
        });

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

      let enquiry: { id: string; conversationId: string };

      if (existingEnquiryId) {
        enquiry = await prisma.enquiry.update({
          where: { id: existingEnquiryId },
          data: {
            status: "DRAFT",
            sourceData: rawText,
            processingError: null,
          },
        });
        await prisma.enquiryItem.deleteMany({ where: { enquiryId: existingEnquiryId } });
        await prisma.enquiryItem.createMany({
          data: itemRows.map((row) => ({ ...row, enquiryId: existingEnquiryId })),
        });
      } else {
        enquiry = await prisma.enquiry.create({
          data: {
            conversationId: resolvedConversationId,
            customerId: resolvedCustomerId,
            createdById: adminUser.id,
            status: "DRAFT",
            sourceData: rawText,
          },
        });

        await prisma.enquiryItem.createMany({
          data: itemRows.map((row) => ({ ...row, enquiryId: enquiry.id })),
        });
      }

      logger.info(
        `${logPrefix} ${existingEnquiryId ? "Updated" : "Created"} DRAFT enquiry ${enquiry.id} with ${matchedItems.length} items`
      );

      emitEnquiryUpdate(enquiry.conversationId, {
        enquiryId: enquiry.id,
        status: "DRAFT",
        itemsCount: matchedItems.length,
      });

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
      const errorMsg = formatUserErrorMessage(error, "Gemini processing failed. Please try again.");

      if (existingEnquiryId) {
        await markEnquiryFailed(existingEnquiryId, errorMsg);
        const enq = await prisma.enquiry.findUnique({
          where: { id: existingEnquiryId },
          select: { conversationId: true },
        });
        if (enq) {
          emitEnquiryUpdate(enq.conversationId, {
            enquiryId: existingEnquiryId,
            status: "FAILED",
            processingError: errorMsg,
          });
        }
      }

      const retryable = error instanceof GeminiApiError ? error.retryable : true;
      await updateJobState("failed", {
        status: "failed",
        failedStep: "inventory_score",
        error: errorMsg,
        retryable,
        rawText,
        ocrConfidence,
      });
    }
  },
  {
    connection: redisConnection,
    concurrency: 2,
    limiter: { max: 2, duration: 1000 },
  }
);
