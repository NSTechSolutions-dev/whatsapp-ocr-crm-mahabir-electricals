import { prisma } from "../lib/prisma";
import { whatsappQueue } from "../jobs/queues";
import { logger } from "../utils/logger";
import type { Msg91DocumentHeader } from "../lib/msg91";
import { normalizePhone } from "../utils/phone";
import { buildStoredTemplateContent } from "../utils/whatsapp-templates";
import {
  ensureConversationForCustomer,
  findOrCreateCustomerByPhone,
} from "./conversation.service";
import { markMessageDelivery } from "./message-delivery.service";

function buildTemplateContent(templateName: string, variables: string[], hasDocument: boolean): string {
  return buildStoredTemplateContent(templateName, variables, hasDocument);
}

export interface TemplateMessageOptions {
  variables?: string[];
  documentHeader?: Msg91DocumentHeader;
  templateNamespace?: string | null;
}

async function resolveInbox(phone: string, conversationId?: string) {
  const customer = await findOrCreateCustomerByPhone(phone);
  const primary = await ensureConversationForCustomer(customer.id);

  // If a conversationId was passed, verify it belongs to this customer; always use the
  // merged primary so quotations / reviews / forwards never open a second inbox.
  if (conversationId && conversationId !== primary.id) {
    const provided = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (provided && provided.customerId === customer.id) {
      // ensureConversation already merged orphans into primary
    } else if (provided && provided.customerId !== customer.id) {
      logger.warn(
        `Conversation ${conversationId} belongs to customer ${provided.customerId}, ` +
          `but phone ${phone} maps to ${customer.id} — using primary inbox ${primary.id}`
      );
    }
  }

  return { customer, conversationId: primary.id };
}

function failureMessage(error: unknown): string {
  const err = error as { response?: { data?: unknown }; message?: string };
  if (err.response?.data) {
    return typeof err.response.data === "string"
      ? err.response.data
      : JSON.stringify(err.response.data);
  }
  return err.message || String(error);
}

export async function sendImageMessage(
  phone: string,
  imageUrl: string,
  caption: string = "",
  conversationId?: string
): Promise<string> {
  try {
    const normalizedPhone = normalizePhone(phone);
    const inbox = await resolveInbox(normalizedPhone, conversationId);
    const resolvedConversationId = inbox.conversationId;

    const message = await prisma.whatsappMessage.create({
      data: {
        conversationId: resolvedConversationId,
        direction: "OUTBOUND",
        type: "image",
        content: caption,
        mediaUrl: imageUrl,
        deliveryStatus: "queued",
        statusUpdatedAt: new Date(),
      },
    });

    await whatsappQueue.add("sendImage", {
      messageId: message.id,
      phone: normalizedPhone,
      type: "image",
      imageUrl,
      caption,
    });

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

/**
 * Sends a WhatsApp template via MSG91 synchronously.
 * Only resolves after MSG91 accepts the request (or mock ack).
 * On failure, the outbound row is kept with deliveryStatus=failed for logs.
 */
export async function sendTemplateMessage(
  phone: string,
  templateName: string,
  variablesOrOptions: string[] | TemplateMessageOptions = [],
  conversationId?: string
): Promise<string> {
  try {
    const normalizedPhone = normalizePhone(phone);
    let variables: string[];
    let documentHeader: Msg91DocumentHeader | undefined;
    let templateNamespace: string | null | undefined;
    if (Array.isArray(variablesOrOptions)) {
      variables = variablesOrOptions;
    } else {
      variables = variablesOrOptions.variables || [];
      documentHeader = variablesOrOptions.documentHeader;
      templateNamespace = variablesOrOptions.templateNamespace;
    }

    const inbox = await resolveInbox(normalizedPhone, conversationId);
    const resolvedConversationId = inbox.conversationId;

    const content = buildTemplateContent(templateName, variables, !!documentHeader);

    const message = await prisma.whatsappMessage.create({
      data: {
        conversationId: resolvedConversationId,
        direction: "OUTBOUND",
        type: documentHeader ? "document" : "template",
        content,
        mediaUrl: documentHeader?.url ?? null,
        templateName,
        deliveryStatus: "queued",
        statusUpdatedAt: new Date(),
      },
    });

    try {
      const { sendToMsg91 } = await import("../lib/msg91");
      const ack = await sendToMsg91({
        to: normalizedPhone,
        type: "template",
        templateName,
        variables,
        documentHeader,
        templateNamespace,
      });
      await markMessageDelivery(message.id, {
        status: "submitted",
        waMessageId: ack.messageUuid || ack.messageId,
        msg91RequestId: ack.requestId || ack.messageId,
        failureReason: null,
        templateName,
      });
    } catch (sendError) {
      await markMessageDelivery(message.id, {
        status: "failed",
        failureReason: failureMessage(sendError),
        templateName,
      });
      throw sendError;
    }

    await prisma.conversation.update({
      where: { id: resolvedConversationId },
      data: { lastMessageAt: new Date() },
    });

    return message.id;
  } catch (error) {
    logger.error(`Failed to send template message for ${phone}: ${error}`);
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
    const inbox = await resolveInbox(normalizedPhone, conversationId);
    const resolvedConversationId = inbox.conversationId;

    const message = await prisma.whatsappMessage.create({
      data: {
        conversationId: resolvedConversationId,
        direction: "OUTBOUND",
        type: "text",
        content: text,
        deliveryStatus: "queued",
        statusUpdatedAt: new Date(),
      },
    });

    try {
      const { sendToMsg91 } = await import("../lib/msg91");
      const ack = await sendToMsg91({
        to: normalizedPhone,
        type: "text",
        text,
      });
      await markMessageDelivery(message.id, {
        status: "submitted",
        waMessageId: ack.messageUuid || ack.messageId,
        msg91RequestId: ack.requestId || ack.messageId,
        failureReason: null,
      });
    } catch (sendError) {
      await markMessageDelivery(message.id, {
        status: "failed",
        failureReason: failureMessage(sendError),
      });
      throw sendError;
    }

    await prisma.conversation.update({
      where: { id: resolvedConversationId },
      data: { lastMessageAt: new Date() },
    });

    return message.id;
  } catch (error) {
    logger.error(`Failed to send text message for ${phone}: ${error}`);
    throw error;
  }
}
