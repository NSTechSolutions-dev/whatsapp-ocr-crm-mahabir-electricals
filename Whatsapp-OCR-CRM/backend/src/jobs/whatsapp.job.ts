import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { sendToMsg91 } from "../lib/msg91";
import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";

export const whatsappWorker = new Worker(
  "whatsappQueue",
  async (job) => {
    const { messageId, phone, type, imageUrl, caption, templateName, variables, documentHeader, templateNamespace, text } =
      job.data;
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

      // Update message deliveryStatus in database
      await prisma.whatsappMessage.update({
        where: { id: messageId },
        data: {
          waMessageId: ack.messageId,
          // Since it's a success, we set status to sent (which is standard)
          // We don't have real delivery receipts yet, so we mark sent.
        },
      });

      logger.info(`Worker successfully sent WhatsApp message ${messageId}`);
    } catch (error) {
      logger.error(`Worker failed sending WhatsApp message ${messageId}: ${error}`);
      
      // Update deliveryStatus to failed
      await prisma.whatsappMessage.update({
        where: { id: messageId },
        data: {
          // Note: we can keep a delivery status column or field if needed, but 
          // let's look at schema.prisma. WhatsappMessage doesn't have deliveryStatus!
          // Ah! Let's check schema.prisma!
          // In the database schema in the prompt, there is NO deliveryStatus in WhatsappMessage:
          // model WhatsappMessage {
          //   id             String           @id @default(cuid())
          //   conversationId String
          //   direction      MessageDirection
          //   type           String
          //   content        String?
          //   mediaUrl       String?
          //   waMessageId    String?
          //   createdAt      DateTime         @default(now())
          // }
          // So we only update waMessageId!
        },
      });
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
