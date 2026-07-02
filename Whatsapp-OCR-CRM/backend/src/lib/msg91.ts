import axios from "axios";
import crypto from "crypto";
import { env } from "../config/env";
import { logger } from "../utils/logger";

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

export interface Msg91SendPayload {
  to: string;
  type: "image" | "template" | "text";
  imageUrl?: string;
  caption?: string;
  templateName?: string;
  variables?: string[];
  text?: string;
}

export async function sendToMsg91(payload: Msg91SendPayload): Promise<{ status: string; messageId: string }> {
  // If in mock environment, log and return mock ID
  const isMock = process.env.MSG91_MOCK !== "0";

  if (isMock) {
    logger.info(`[MSG91 MOCK] Sending ${payload.type} to ${payload.to}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      status: "ok",
      messageId: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };
  }

  // Real MSG91 API configuration
  // Real REST endpoint: https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message
  try {
    const response = await axios.post(
      "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message",
      {
        integratedNumber: env.MSG91_INTEGRATED_NUMBER,
        recipients: [
          {
            phone: payload.to,
            media: payload.imageUrl ? { url: payload.imageUrl, type: "image", caption: payload.caption } : undefined,
            template: payload.templateName ? {
              name: payload.templateName,
              components: {
                body: {
                  type: "text",
                  values: payload.variables || [],
                },
              },
            } : undefined,
            message: payload.text ? { type: "text", value: payload.text } : undefined,
          },
        ],
      },
      {
        headers: {
          authkey: env.MSG91_AUTH_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    return {
      status: response.data.status || "ok",
      messageId: response.data.messageId || `msg91-${Date.now()}`,
    };
  } catch (error: any) {
    logger.error("MSG91 API request failed: " + (error.response?.data ? JSON.stringify(error.response.data) : error.message));
    throw error;
  }
}
