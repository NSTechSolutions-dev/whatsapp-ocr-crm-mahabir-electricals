import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";

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
  if (value === "sent") return "sent";
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
    return existing;
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

export async function applyOutboundDeliveryReport(payload: Record<string, unknown>) {
  const status =
    normalizeDeliveryStatus(payload.status) ||
    normalizeDeliveryStatus(payload.eventName) ||
    normalizeDeliveryStatus((payload as { event_name?: unknown }).event_name);

  if (!status) {
    logger.warn(`Outbound DLR ignored — unknown status: ${JSON.stringify(payload.status || payload.eventName)}`);
    return { updated: false, reason: "unknown_status" as const };
  }

  const messageUuid =
    (typeof payload.message_uuid === "string" && payload.message_uuid) ||
    (typeof payload.messageUuid === "string" && payload.messageUuid) ||
    (typeof payload.uuid === "string" && payload.uuid) ||
    null;

  const requestId =
    (typeof payload.request_id === "string" && payload.request_id) ||
    (typeof payload.requestId === "string" && payload.requestId) ||
    (typeof payload.campaign_request_id === "string" && payload.campaign_request_id) ||
    null;

  const failureReason =
    (typeof payload.failedReason === "string" && payload.failedReason) ||
    (typeof payload.failureReason === "string" && payload.failureReason) ||
    (typeof payload.error === "string" && payload.error) ||
    (typeof payload.errors === "string" && payload.errors) ||
    null;

  const orFilters: Array<Record<string, string>> = [];
  if (messageUuid) {
    orFilters.push({ waMessageId: messageUuid });
    orFilters.push({ msg91RequestId: messageUuid });
  }
  if (requestId) {
    orFilters.push({ msg91RequestId: requestId });
    orFilters.push({ waMessageId: requestId });
  }

  if (orFilters.length === 0) {
    logger.warn("Outbound DLR ignored — no message_uuid/request_id");
    return { updated: false, reason: "missing_ids" as const };
  }

  const message = await prisma.whatsappMessage.findFirst({
    where: {
      direction: "OUTBOUND",
      OR: orFilters,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!message) {
    logger.warn(
      `Outbound DLR unmatched status=${status} uuid=${messageUuid || "-"} request=${requestId || "-"}`
    );
    return { updated: false, reason: "not_found" as const };
  }

  await markMessageDelivery(message.id, {
    status,
    waMessageId: messageUuid || undefined,
    msg91RequestId: requestId || undefined,
    failureReason: status === "failed" ? failureReason : null,
  });

  logger.info(`Outbound DLR applied message=${message.id} status=${status}`);
  return { updated: true, messageId: message.id, status };
}

export function isOutboundDeliveryPayload(payload: Record<string, unknown>): boolean {
  const direction = String(payload.direction || "").toLowerCase();
  if (direction === "outbound" || direction === "outgoing") return true;

  const status =
    normalizeDeliveryStatus(payload.status) ||
    normalizeDeliveryStatus(payload.eventName) ||
    normalizeDeliveryStatus((payload as { event_name?: unknown }).event_name);

  if (!status) return false;

  const hasIds = Boolean(
    payload.message_uuid ||
      payload.messageUuid ||
      payload.request_id ||
      payload.requestId ||
      payload.campaign_request_id
  );

  // Inbound customer messages usually include text/media content, not DLR status fields.
  const looksLikeInboundMessage = Boolean(
    payload.messages ||
      payload.message ||
      payload.text ||
      payload.body ||
      payload.url ||
      payload.mediaUrl
  );

  if (hasIds && !looksLikeInboundMessage) return true;
  if (hasIds && (payload.customer_number || payload.customerNumber || payload.integrated_number)) {
    // Status-only outbound reports often include customer_number + status
    if (["submitted", "sent", "delivered", "read", "failed"].includes(status)) {
      return !payload.messages;
    }
  }

  return false;
}
