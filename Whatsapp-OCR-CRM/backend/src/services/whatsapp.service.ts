import { prisma } from "../lib/prisma";
import { whatsappQueue } from "../jobs/queues";
import { logger } from "../utils/logger";
import type { Msg91DocumentHeader } from "../lib/msg91";
import { normalizePhone } from "../utils/phone";
import { buildStoredTemplateContent } from "../utils/whatsapp-templates";

function buildTemplateContent(templateName: string, variables: string[], hasDocument: boolean): string {
  return buildStoredTemplateContent(templateName, variables, hasDocument);
}

export interface TemplateMessageOptions {
  variables?: string[];
  documentHeader?: Msg91DocumentHeader;
}

export async function sendImageMessage(
  phone: string,
  imageUrl: string,
  caption: string = "",
  conversationId?: string
): Promise<string> {
  try {
    const normalizedPhone = normalizePhone(phone);
    let resolvedConversationId = conversationId;

    // Find customer by phone
    let customer = await prisma.customer.findUnique({ where: { phone: normalizedPhone } });
    if (!customer) {
      customer = await prisma.customer.create({ data: { phone: normalizedPhone } });
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
      phone: normalizedPhone,
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
  variablesOrOptions: string[] | TemplateMessageOptions = [],
  conversationId?: string
): Promise<string> {
  try {
    const normalizedPhone = normalizePhone(phone);
    let resolvedConversationId = conversationId;

    let variables: string[];
    let documentHeader: Msg91DocumentHeader | undefined;
    if (Array.isArray(variablesOrOptions)) {
      variables = variablesOrOptions;
    } else {
      variables = variablesOrOptions.variables || [];
      documentHeader = variablesOrOptions.documentHeader;
    }

    let customer = await prisma.customer.findUnique({ where: { phone: normalizedPhone } });
    if (!customer) {
      customer = await prisma.customer.create({ data: { phone: normalizedPhone } });
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

    const content = buildTemplateContent(templateName, variables, !!documentHeader);

    const message = await prisma.whatsappMessage.create({
      data: {
        conversationId: resolvedConversationId,
        direction: "OUTBOUND",
        type: documentHeader ? "document" : "template",
        content,
        mediaUrl: documentHeader?.url ?? null,
      },
    });

    await whatsappQueue.add("sendTemplate", {
      messageId: message.id,
      phone: normalizedPhone,
      type: "template",
      templateName,
      variables,
      documentHeader,
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
    const normalizedPhone = normalizePhone(phone);
    let resolvedConversationId = conversationId;

    let customer = await prisma.customer.findUnique({ where: { phone: normalizedPhone } });
    if (!customer) {
      customer = await prisma.customer.create({ data: { phone: normalizedPhone } });
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
      phone: normalizedPhone,
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
