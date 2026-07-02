import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { generateQuotation } from "../services/quotation.service";
import { logger } from "../utils/logger";

export const quotationWorker = new Worker(
  "quotationQueue",
  async (job) => {
    const { enquiryId, gstPercent = 18 } = job.data;
    logger.info(`Worker starting quotation generation for enquiry ${enquiryId}`);
    try {
      const quotation = await generateQuotation(enquiryId, gstPercent);
      logger.info(`Worker completed quotation ${quotation.id} for enquiry ${enquiryId}`);
      return quotation;
    } catch (error) {
      logger.error(`Worker failed quotation generation for enquiry ${enquiryId}: ${error}`);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 3,
  }
);
