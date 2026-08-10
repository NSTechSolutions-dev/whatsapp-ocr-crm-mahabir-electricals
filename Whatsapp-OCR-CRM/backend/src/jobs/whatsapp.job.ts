import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { sendToMsg91 } from "../lib/msg91";
import { logger } from "../utils/logger";
import { markMessageDelivery } from "../services/message-delivery.service";

export const whatsappWorker = new Worker(
  "whatsappQueue",
  async (job) => {
    const {
      messageId,
      phone,
      type,
      imageUrl,
      caption,
      templateName,
      variables,
      documentHeader,
      templateNamespace,
      text,
    } = job.data;
    logger.info(`Worker sending WhatsApp message: ${messageId} to ${phone}`);

    try {
      const ack = await sendToMsg91({
        to: phone,
        type,
        imageUrl,
        caption,
        templateName,
        variables,
        documentHeader,
        templateNamespace,
        text,
      });

      await markMessageDelivery(messageId, {
        status: "submitted",
        waMessageId: ack.messageId,
        msg91RequestId: ack.messageId,
        failureReason: null,
        templateName: templateName || undefined,
      });

      logger.info(`Worker successfully sent WhatsApp message ${messageId}`);
    } catch (error) {
      const err = error as { response?: { data?: unknown }; message?: string };
      const reason = err.response?.data
        ? typeof err.response.data === "string"
          ? err.response.data
          : JSON.stringify(err.response.data)
        : err.message || String(error);

      await markMessageDelivery(messageId, {
        status: "failed",
        failureReason: reason,
        templateName: templateName || undefined,
      });

      logger.error(`Worker failed sending WhatsApp message ${messageId}: ${error}`);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 10,
    limiter: {
      max: 10,
      duration: 1000,
    },
  }
);
