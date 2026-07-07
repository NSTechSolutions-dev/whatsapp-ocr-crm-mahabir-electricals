import axios from "axios";
import crypto from "crypto";
import { env } from "../config/env";
import { logger } from "../utils/logger";

const MSG91_BULK_URL = "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";

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
  variables?: string[];
  documentHeader?: Msg91DocumentHeader;
  text?: string;
}

function normalizePhoneForMsg91(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
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

export async function sendToMsg91(payload: Msg91SendPayload): Promise<{ status: string; messageId: string }> {
  const isMock = process.env.MSG91_MOCK !== "0";

  if (isMock) {
    logger.info(`[MSG91 MOCK] Sending ${payload.type} to ${payload.to}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      status: "ok",
      messageId: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    };
  }

  if (payload.type !== "template" || !payload.templateName) {
    logger.warn(`MSG91 send type "${payload.type}" is not implemented with the bulk template API`);
    throw new Error(`Unsupported MSG91 message type: ${payload.type}`);
  }

  const phone = normalizePhoneForMsg91(payload.to);
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
        namespace: env.MSG91_WHATSAPP_NAMESPACE,
        to_and_components: [
          {
            to: [phone],
            components: buildTemplateComponents(payload.variables || [], payload.documentHeader),
          },
        ],
      },
    },
  };

  try {
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
  } catch (error: unknown) {
    const err = error as { response?: { data?: unknown }; message?: string };
    logger.error(
      "MSG91 API request failed: " + (err.response?.data ? JSON.stringify(err.response.data) : err.message)
    );
    throw error;
  }
}
