import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";
import { normalizePhone } from "../utils/phone";

export type DeliveryStatus =
  | "queued"
  | "submitted"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

const STATUS_RANK: Record<DeliveryStatus, number> = {
  queued: 0,
  submitted: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 5,
};

export function normalizeDeliveryStatus(raw: unknown): DeliveryStatus | null {
  if (raw == null) return null;
  const value = String(raw).trim().toLowerCase();
  if (!value) return null;
  if (value === "queued" || value === "pending") return "queued";
  if (value === "submitted" || value === "accepted" || value === "success" || value === "ok") {
    return "submitted";
  }
  // MSG91 "send" event = handed to Meta
  if (value === "sent" || value === "send") return "sent";
  if (value === "delivered" || value === "delivery") return "delivered";
  if (value === "read" || value === "seen") return "read";
  if (
    value === "failed" ||
    value === "failure" ||
    value === "error" ||
    value === "undelivered" ||
    value === "rejected"
  ) {
    return "failed";
  }
  return null;
}

function shouldAdvance(current: string | null | undefined, next: DeliveryStatus): boolean {
  const currentNorm = normalizeDeliveryStatus(current) || "queued";
  if (next === "failed") return true;
  if (currentNorm === "failed") return false;
  return STATUS_RANK[next] >= STATUS_RANK[currentNorm];
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export async function markMessageDelivery(
  messageId: string,
  input: {
    status: DeliveryStatus;
    waMessageId?: string | null;
    msg91RequestId?: string | null;
    failureReason?: string | null;
    templateName?: string | null;
  }
) {
  const existing = await prisma.whatsappMessage.findUnique({ where: { id: messageId } });
  if (!existing) return null;

  if (!shouldAdvance(existing.deliveryStatus, input.status)) {
    // Still attach newer provider ids even if status does not advance
    const patch: {
      waMessageId?: string;
      msg91RequestId?: string;
      statusUpdatedAt?: Date;
    } = {};
    if (input.waMessageId && input.waMessageId !== existing.waMessageId) {
      patch.waMessageId = input.waMessageId;
    }
    if (input.msg91RequestId && input.msg91RequestId !== existing.msg91RequestId) {
      patch.msg91RequestId = input.msg91RequestId;
    }
    if (Object.keys(patch).length === 0) return existing;
    patch.statusUpdatedAt = new Date();
    return prisma.whatsappMessage.update({ where: { id: messageId }, data: patch });
  }

  const data: {
    deliveryStatus: DeliveryStatus;
    statusUpdatedAt: Date;
    waMessageId?: string;
    msg91RequestId?: string;
    failureReason?: string | null;
    templateName?: string;
  } = {
    deliveryStatus: input.status,
    statusUpdatedAt: new Date(),
  };

  if (input.waMessageId) data.waMessageId = input.waMessageId;
  if (input.msg91RequestId) data.msg91RequestId = input.msg91RequestId;
  if (input.templateName) data.templateName = input.templateName;
  if (input.status === "failed") {
    data.failureReason = input.failureReason || existing.failureReason || "Send failed";
  } else if (input.failureReason === null) {
    data.failureReason = null;
  }

  return prisma.whatsappMessage.update({
    where: { id: messageId },
    data,
  });
}

async function findOutboundForDlr(input: {
  messageUuid: string | null;
  requestId: string | null;
  phone: string | null;
  templateName: string | null;
}) {
  const orFilters: Array<Record<string, string>> = [];
  if (input.messageUuid) {
    orFilters.push({ waMessageId: input.messageUuid });
    orFilters.push({ msg91RequestId: input.messageUuid });
  }
  if (input.requestId) {
    orFilters.push({ msg91RequestId: input.requestId });
    orFilters.push({ waMessageId: input.requestId });
  }

  if (orFilters.length > 0) {
    const byId = await prisma.whatsappMessage.findFirst({
      where: {
        direction: "OUTBOUND",
        OR: orFilters,
      },
      orderBy: { createdAt: "desc" },
    });
    if (byId) return byId;
  }

  // Fallback: match recent outbound to same phone (MSG91 send response id may differ from DLR ids)
  if (!input.phone) return null;
  const normalized = normalizePhone(input.phone);
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const candidates = await prisma.whatsappMessage.findMany({
    where: {
      direction: "OUTBOUND",
      createdAt: { gte: since },
      deliveryStatus: { in: ["queued", "submitted", "sent", "delivered"] },
      conversation: { customer: { phone: normalized } },
      ...(input.templateName ? { templateName: input.templateName } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  if (candidates.length === 0) return null;

  // Prefer rows still waiting for a DLR upgrade
  return (
    candidates.find((m) => ["queued", "submitted", "sent"].includes(m.deliveryStatus)) ||
    candidates[0]
  );
}

export async function applyOutboundDeliveryReport(payload: Record<string, unknown>) {
  const status =
    normalizeDeliveryStatus(payload.eventName) ||
    normalizeDeliveryStatus(payload.status) ||
    normalizeDeliveryStatus((payload as { event_name?: unknown }).event_name);

  if (!status) {
    logger.warn(
      `Outbound DLR ignored — unknown status: ${JSON.stringify(payload.eventName || payload.status)}`
    );
    return { updated: false, reason: "unknown_status" as const };
  }

  const messageUuid = firstString(
    payload.uuid,
    payload.message_uuid,
    payload.messageUuid,
    payload.message_id,
    payload.messageId
  );

  const requestId = firstString(
    payload.requestId,
    payload.request_id,
    payload.campaignRequestId,
    payload.campaign_request_id,
    payload.oneApiRequestId
  );

  const phone = firstString(
    payload.customerNumber,
    payload.customer_number,
    payload.recipient_number,
    payload.to
  );

  const templateName = firstString(payload.templateName, payload.template_name);
  const failureReason = firstString(
    payload.reason,
    payload.failedReason,
    payload.failureReason,
    payload.error,
    payload.errors
  );

  const message = await findOutboundForDlr({
    messageUuid,
    requestId,
    phone,
    templateName,
  });

  if (!message) {
    logger.warn(
      `Outbound DLR unmatched status=${status} uuid=${messageUuid || "-"} request=${requestId || "-"} phone=${phone || "-"}`
    );
    return { updated: false, reason: "not_found" as const };
  }

  await markMessageDelivery(message.id, {
    status,
    // Prefer Meta wamid as waMessageId when present
    waMessageId: messageUuid || undefined,
    msg91RequestId: requestId || undefined,
    failureReason: status === "failed" ? failureReason : null,
    templateName: templateName || undefined,
  });

  logger.info(
    `Outbound DLR applied message=${message.id} status=${status} request=${requestId || "-"} uuid=${messageUuid || "-"}`
  );
  return { updated: true, messageId: message.id, status };
}

/**
 * MSG91 Webhook (New) uses direction "1" = outbound, "0" = inbound.
 * Older webhooks used "outbound" / "inbound".
 */
export function isOutboundDeliveryPayload(payload: Record<string, unknown>): boolean {
  const directionRaw = payload.direction;
  const direction = String(directionRaw ?? "").trim().toLowerCase();

  if (direction === "0" || direction === "inbound" || direction === "incoming") {
    return false;
  }

  // Inbound chat payloads include a messages array / free-form text body
  const messages = payload.messages;
  const hasInboundMessages =
    (typeof messages === "string" && messages.trim().startsWith("[")) ||
    Array.isArray(messages);
  if (hasInboundMessages) return false;

  if (
    direction === "1" ||
    direction === "outbound" ||
    direction === "outgoing"
  ) {
    return true;
  }

  const status =
    normalizeDeliveryStatus(payload.eventName) ||
    normalizeDeliveryStatus(payload.status) ||
    normalizeDeliveryStatus((payload as { event_name?: unknown }).event_name);

  if (!status) return false;

  const hasIds = Boolean(
    firstString(
      payload.requestId,
      payload.request_id,
      payload.uuid,
      payload.message_uuid,
      payload.messageUuid,
      payload.campaignRequestId
    )
  );

  // Status callbacks for outbound always carry requestId/uuid; inbound "delivered" usually has text/messages
  const hasInboundText =
    (typeof payload.text === "string" && payload.text.trim().length > 0) ||
    (typeof payload.contentType === "string" &&
      payload.contentType.trim().length > 0 &&
      payload.contentType !== "template");

  if (hasIds && !hasInboundText) return true;

  return false;
}

/** Normalize webhook body that may be a single object or an array of events. */
export function asWebhookPayloadList(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.data)) {
      const nested = record.data.filter(
        (item): item is Record<string, unknown> => !!item && typeof item === "object"
      );
      if (nested.length > 0) return nested;
    }
    return [record];
  }
  return [];
}
