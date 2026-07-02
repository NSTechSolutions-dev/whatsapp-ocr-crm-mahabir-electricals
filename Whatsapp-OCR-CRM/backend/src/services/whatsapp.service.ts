import { prisma } from "../lib/prisma";
import { whatsappQueue } from "../jobs/queues";
import { logger } from "../utils/logger";

export async function sendImageMessage(
  phone: string,
  imageUrl: string,
  caption: string = "",
  conversationId?: string
): Promise<string> {
  try {
    let resolvedConversationId = conversationId;

    // Find customer by phone
    let customer = await prisma.customer.findUnique({ where: { phone } });
    if (!customer) {
      customer = await prisma.customer.create({ data: { phone } });
    }

    if (!resolvedConversationId) {
      const waConversationId = `wa-${customer.id}`;
      let conversation = await prisma.conversation.findUnique({ where: { waConversationId } });
      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            customerId: customer.id,
            waConversationId,
          },
        });
      }
      resolvedConversationId = conversation.id;
    }

    // Insert WhatsappMessage with OUTBOUND direction
    const message = await prisma.whatsappMessage.create({
      data: {
        conversationId: resolvedConversationId,
        direction: "OUTBOUND",
        type: "image",
        content: caption,
        mediaUrl: imageUrl,
      },
    });

    // Enqueue MSG91 sending via BullMQ
    await whatsappQueue.add("sendImage", {
      messageId: message.id,
      phone,
      type: "image",
      imageUrl,
      caption,
    });

    // Bump conversation lastMessageAt
    await prisma.conversation.update({
      where: { id: resolvedConversationId },
      data: { lastMessageAt: new Date() },
    });

    return message.id;
  } catch (error) {
    logger.error(`Failed to stage image message for ${phone}: ${error}`);
    throw error;
  }
}

export async function sendTemplateMessage(
  phone: string,
  templateName: string,
  variables: string[] = [],
  conversationId?: string
): Promise<string> {
  try {
    let resolvedConversationId = conversationId;

    let customer = await prisma.customer.findUnique({ where: { phone } });
    if (!customer) {
      customer = await prisma.customer.create({ data: { phone } });
    }

    if (!resolvedConversationId) {
      const waConversationId = `wa-${customer.id}`;
      let conversation = await prisma.conversation.findUnique({ where: { waConversationId } });
      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            customerId: customer.id,
            waConversationId,
          },
        });
      }
      resolvedConversationId = conversation.id;
    }

    const content = `${templateName} | ${variables.join(" ")}`;

    const message = await prisma.whatsappMessage.create({
      data: {
        conversationId: resolvedConversationId,
        direction: "OUTBOUND",
        type: "template",
        content,
      },
    });

    await whatsappQueue.add("sendTemplate", {
      messageId: message.id,
      phone,
      type: "template",
      templateName,
      variables,
    });

    await prisma.conversation.update({
      where: { id: resolvedConversationId },
      data: { lastMessageAt: new Date() },
    });

    return message.id;
  } catch (error) {
    logger.error(`Failed to stage template message for ${phone}: ${error}`);
    throw error;
  }
}

export async function sendTextMessage(
  phone: string,
  text: string,
  conversationId?: string
): Promise<string> {
  try {
    let resolvedConversationId = conversationId;

    let customer = await prisma.customer.findUnique({ where: { phone } });
    if (!customer) {
      customer = await prisma.customer.create({ data: { phone } });
    }

    if (!resolvedConversationId) {
      const waConversationId = `wa-${customer.id}`;
      let conversation = await prisma.conversation.findUnique({ where: { waConversationId } });
      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            customerId: customer.id,
            waConversationId,
          },
        });
      }
      resolvedConversationId = conversation.id;
    }

    const message = await prisma.whatsappMessage.create({
      data: {
        conversationId: resolvedConversationId,
        direction: "OUTBOUND",
        type: "text",
        content: text,
      },
    });

    await whatsappQueue.add("sendText", {
      messageId: message.id,
      phone,
      type: "text",
      text,
    });

    await prisma.conversation.update({
      where: { id: resolvedConversationId },
      data: { lastMessageAt: new Date() },
    });

    return message.id;
  } catch (error) {
    logger.error(`Failed to stage text message for ${phone}: ${error}`);
    throw error;
  }
}
