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
  if (!data || typeof data !== "object") return `msg91-${Date.now()}`;
  const record = data as Record<string, unknown>;
  if (typeof record.request_id === "string") return record.request_id;
  if (typeof record.messageId === "string") return record.messageId;
  if (typeof record.message_id === "string") return record.message_id;
  if (Array.isArray(record.data) && record.data[0] && typeof record.data[0] === "object") {
    const first = record.data[0] as Record<string, unknown>;
    if (typeof first.message_uuid === "string") return first.message_uuid;
  }
  return `msg91-${Date.now()}`;
}

async function sendSessionTextToMsg91(
  phone: string,
  text: string
): Promise<{ status: string; messageId: string }> {
  const recipient = normalizePhoneForMsg91(phone);

  // MSG91 session text uses query params (not a JSON body). Sending
  // Content-Type: application/json with an empty/null body causes:
  // "Invalid json in request for Content type:-application/json"
  const response = await axios.post(
    MSG91_SESSION_TEXT_URL,
    undefined,
    {
      params: {
        integrated_number: env.MSG91_INTEGRATED_NUMBER,
        recipient_number: recipient,
        content_type: "text",
        text,
      },
      headers: {
        authkey: env.MSG91_AUTH_KEY,
      },
      // Prevent axios from inventing application/json for an empty body.
      transformRequest: [
        (data, headers) => {
          if (headers && typeof headers === "object") {
            delete (headers as Record<string, unknown>)["Content-Type"];
            delete (headers as Record<string, unknown>)["content-type"];
          }
          return data;
        },
      ],
      maxRedirects: 5,
      validateStatus: () => true,
    }
  );

  const data = response.data;
  if (response.status < 200 || response.status >= 300 || isMsg91ErrorPayload(data)) {
    throw new Error(
      `MSG91 session text failed (${response.status}): ${typeof data === "string" ? data : JSON.stringify(data)}`
    );
  }

  logger.info(`MSG91 session text sent to ${recipient}: ${JSON.stringify(data)}`);
  return {
    status: (data as { status?: string })?.status || "ok",
    messageId: extractMessageId(data),
  };
}

function isMsg91ErrorPayload(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  const type = String(record.type || record.status || "").toLowerCase();
  if (type === "error" || type === "failed" || type === "failure") return true;
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
): Promise<{ status: string; messageId: string }> {
  if (!payload.templateName) {
    throw new Error("Template name is required");
  }

  const phone = normalizePhoneForMsg91(payload.to);
  const namespace =
    payload.templateNamespace !== undefined ? payload.templateNamespace : env.MSG91_WHATSAPP_NAMESPACE;
  const body = {
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

  const response = await axios.post(MSG91_BULK_URL, body, {
    headers: {
      authkey: env.MSG91_AUTH_KEY,
      "Content-Type": "application/json",
    },
    maxRedirects: 5,
  });

  logger.info(`MSG91 template "${payload.templateName}" sent to ${phone}`);
  return {
    status: (response.data as { status?: string })?.status || "ok",
    messageId: extractMessageId(response.data),
  };
}

export async function sendToMsg91(payload: Msg91SendPayload): Promise<{ status: string; messageId: string }> {
  const isMock = process.env.MSG91_MOCK !== "0";

  if (isMock) {
    logger.warn(
      `[MSG91 MOCK] Skipping real WhatsApp send for ${payload.type} → ${payload.to}. Set MSG91_MOCK=0 to deliver.`
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      status: "ok",
      messageId: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    };
  }

  try {
    if (payload.type === "text") {
      const text = (payload.text || "").trim();
      if (!text) throw new Error("Text message body is required");
      return await sendSessionTextToMsg91(payload.to, text);
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
