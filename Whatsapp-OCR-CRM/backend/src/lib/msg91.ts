import axios from "axios";
import crypto from "crypto";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { formatPhoneForWhatsApp } from "../utils/phone";

const MSG91_BULK_URL = "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";
const MSG91_SESSION_TEXT_URL =
  "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/";

export function verifyMsg91Signature(rawBody: Buffer, signature: string, secret: string): boolean {
  try {
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(rawBody);
    const expected = hmac.digest("hex");
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch (error) {
    logger.error("Failed verifying MSG91 signature: " + error);
    return false;
  }
}

export interface Msg91DocumentHeader {
  url: string;
  filename: string;
}

export interface Msg91SendPayload {
  to: string;
  type: "image" | "template" | "text";
  imageUrl?: string;
  caption?: string;
  templateName?: string;
  templateNamespace?: string | null;
  variables?: string[];
  documentHeader?: Msg91DocumentHeader;
  text?: string;
  /** Returned in MSG91 outbound DLR as crqid — use our WhatsappMessage.id */
  crqid?: string;
}

function normalizePhoneForMsg91(phone: string): string {
  return formatPhoneForWhatsApp(phone);
}

function buildTemplateComponents(
  variables: string[],
  documentHeader?: Msg91DocumentHeader
): Record<string, { type: string; value: string; filename?: string }> {
  const components: Record<string, { type: string; value: string; filename?: string }> = {};

  if (documentHeader) {
    components.header_1 = {
      type: "document",
      value: documentHeader.url,
      filename: documentHeader.filename,
    };
  }

  variables.forEach((value, index) => {
    components[`body_${index + 1}`] = { type: "text", value };
  });

  return components;
}

function extractMessageId(data: unknown): string {
  const ids = extractMsg91Ids(data);
  return ids.requestId || ids.messageUuid || `msg91-${Date.now()}`;
}

export function extractMsg91Ids(data: unknown): {
  messageId: string;
  requestId: string | null;
  messageUuid: string | null;
} {
  const requestIds: string[] = [];
  const uuids: string[] = [];

  const visit = (node: unknown, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 4) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string" && value.trim()) {
        const k = key.toLowerCase();
        if (
          k === "request_id" ||
          k === "requestid" ||
          k === "campaign_request_id" ||
          k === "campaignrequestid"
        ) {
          requestIds.push(value.trim());
        }
        if (
          k === "message_uuid" ||
          k === "messageuuid" ||
          k === "uuid" ||
          k === "message_id" ||
          k === "messageid" ||
          k === "wamid"
        ) {
          uuids.push(value.trim());
        }
      } else if (value && typeof value === "object") {
        visit(value, depth + 1);
      }
    }
  };

  visit(data);
  const requestId = requestIds[0] || null;
  const messageUuid = uuids[0] || null;
  const messageId = requestId || messageUuid || `msg91-${Date.now()}`;
  return { messageId, requestId, messageUuid };
}

export type Msg91Ack = {
  status: string;
  messageId: string;
  requestId?: string | null;
  messageUuid?: string | null;
};

async function sendSessionTextToMsg91(
  phone: string,
  text: string,
  crqid?: string
): Promise<Msg91Ack> {
  const recipient = normalizePhoneForMsg91(phone);

  // Session text uses a flat JSON body (not Meta-style nested payload,
  // and not query-params-only — those return 400 / invalid JSON).
  const body: Record<string, string> = {
    integrated_number: env.MSG91_INTEGRATED_NUMBER,
    recipient_number: recipient,
    content_type: "text",
    text,
  };
  if (crqid) body.CRQID = crqid;

  const response = await axios.post(MSG91_SESSION_TEXT_URL, body, {
    headers: {
      authkey: env.MSG91_AUTH_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    maxRedirects: 5,
    validateStatus: () => true,
  });

  const data = response.data;
  if (response.status < 200 || response.status >= 300 || isMsg91ErrorPayload(data)) {
    throw new Error(
      `MSG91 session text failed (${response.status}): ${typeof data === "string" ? data : JSON.stringify(data)}`
    );
  }

  logger.info(`MSG91 session text sent to ${recipient}: ${JSON.stringify(data)}`);
  const ids = extractMsg91Ids(data);
  return {
    status: (data as { status?: string })?.status || "ok",
    messageId: ids.messageId,
    requestId: ids.requestId,
    messageUuid: ids.messageUuid,
  };
}

function isMsg91ErrorPayload(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  const type = String(record.type || record.status || "").toLowerCase();
  if (type === "error" || type === "failed" || type === "failure" || type === "fail") return true;
  if (record.hasError === true || record.error === true) return true;
  if (typeof record.message === "string" && /error|fail|invalid|unauthorized/i.test(record.message)) {
    // MSG91 sometimes returns { message: "success", type: "success" } — allow those
    if (/success/i.test(String(record.type || ""))) return false;
    if (/^success$/i.test(record.message)) return false;
  }
  return false;
}

async function sendTemplateToMsg91(
  payload: Msg91SendPayload
): Promise<Msg91Ack> {
  if (!payload.templateName) {
    throw new Error("Template name is required");
  }

  const phone = normalizePhoneForMsg91(payload.to);
  const namespace =
    payload.templateNamespace !== undefined ? payload.templateNamespace : env.MSG91_WHATSAPP_NAMESPACE;
  const body: Record<string, unknown> = {
    integrated_number: env.MSG91_INTEGRATED_NUMBER,
    content_type: "template",
    payload: {
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: payload.templateName,
        language: {
          code: env.MSG91_TEMPLATE_LANGUAGE,
          policy: "deterministic",
        },
        namespace,
        to_and_components: [
          {
            to: [phone],
            components: buildTemplateComponents(payload.variables || [], payload.documentHeader),
          },
        ],
      },
    },
  };
  if (payload.crqid) {
    body.CRQID = payload.crqid;
  }

  const response = await axios.post(MSG91_BULK_URL, body, {
    headers: {
      authkey: env.MSG91_AUTH_KEY,
      "Content-Type": "application/json",
    },
    maxRedirects: 5,
    validateStatus: () => true,
  });

  const data = response.data;
  if (response.status < 200 || response.status >= 300 || isMsg91ErrorPayload(data)) {
    throw new Error(
      `MSG91 template failed (${response.status}): ${typeof data === "string" ? data : JSON.stringify(data)}`
    );
  }

  logger.info(`MSG91 template "${payload.templateName}" sent to ${phone}: ${JSON.stringify(data)}`);
  const ids = extractMsg91Ids(data);
  return {
    status: (data as { status?: string })?.status || "ok",
    messageId: ids.messageId,
    requestId: ids.requestId,
    messageUuid: ids.messageUuid,
  };
}

export async function sendToMsg91(payload: Msg91SendPayload): Promise<Msg91Ack> {
  const isMock = process.env.MSG91_MOCK !== "0";

  if (isMock) {
    logger.warn(
      `[MSG91 MOCK] Skipping real WhatsApp send for ${payload.type} → ${payload.to}. Set MSG91_MOCK=0 to deliver.`
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const id = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    return {
      status: "ok",
      messageId: id,
      requestId: id,
      messageUuid: null,
    };
  }

  try {
    if (payload.type === "text") {
      const text = (payload.text || "").trim();
      if (!text) throw new Error("Text message body is required");
      return await sendSessionTextToMsg91(payload.to, text, payload.crqid);
    }

    if (payload.type === "template") {
      return await sendTemplateToMsg91(payload);
    }

    logger.warn(`MSG91 send type "${payload.type}" is not implemented`);
    throw new Error(`Unsupported MSG91 message type: ${payload.type}`);
  } catch (error: unknown) {
    const err = error as { response?: { data?: unknown }; message?: string };
    logger.error(
      "MSG91 API request failed: " + (err.response?.data ? JSON.stringify(err.response.data) : err.message)
    );
    throw error;
  }
}
