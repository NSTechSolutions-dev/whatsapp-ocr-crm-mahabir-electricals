import axios from "axios";
import fs from "fs/promises";
import path from "path";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { GeminiApiError, withGeminiBackoff } from "./gemini-retry";

const GEMINI_VISION_MODEL = env.GEMINI_VISION_MODEL;
const LOG_ENABLED = env.NODE_ENV === "development";

const OCR_PROMPT = `You are an expert OCR engine for handwritten and printed Indian product order forms and enquiry slips.

Transcribe ALL readable text from the image exactly as written.

Rules:
- Preserve original line breaks, spelling (including mistakes), and formatting
- Include product lines, quantities, headers, shop names, addresses, dates — everything visible
- Do NOT interpret, summarize, categorize, or extract structured JSON
- Do NOT strip or normalize text — literal transcription only
- Return ONLY plain transcribed text. No markdown, no code fences, no explanation.`;

function requireGeminiKey(): string {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey || apiKey.includes("placeholder")) {
    throw new GeminiApiError("GEMINI_API_KEY is not configured", undefined, false);
  }
  return apiKey;
}

function estimateConfidence(fullText: string): number {
  const text = (fullText || "").trim();
  if (!text) return 0.3;

  const lines = text.split(/[\n\r]+/).filter((l) => l.trim().length > 0);
  let score = 0.7;
  if (text.length > 20) score += 0.1;
  if (lines.length > 1) score += 0.05;
  if (/\d/.test(text)) score += 0.05;
  return parseFloat(Math.min(score, 0.98).toFixed(2));
}

function parsePlainTextResponse(content: string): string {
  let text = (content || "").trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  }
  return text;
}

function appendGeminiLog(chunk: string): void {
  if (!LOG_ENABLED) return;
  const logFilePath = path.join(process.cwd(), "logs", "gemini_io.log");
  void fs.mkdir(path.dirname(logFilePath), { recursive: true })
    .then(() => fs.appendFile(logFilePath, chunk, "utf8"))
    .catch(() => {});
}

async function callGeminiDirect(imageBuffer: Buffer): Promise<{ fullText: string; source: string }> {
  const apiKey = requireGeminiKey();
  const base64Image = imageBuffer.toString("base64");

  appendGeminiLog(
    `\n=== GEMINI DIRECT VISION OCR CALL ${new Date().toISOString()} ===\n` +
      `PROMPT: ${OCR_PROMPT}\n` +
      `IMAGE BUFFER SIZE: ${imageBuffer.length} bytes\n` +
      `----------------------------------------\n`
  );

  try {
    const response = await withGeminiBackoff(
      () =>
        axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${apiKey}`,
          {
            contents: [
              {
                role: "user",
                parts: [
                  { text: OCR_PROMPT },
                  {
                    inlineData: {
                      mimeType: "image/jpeg",
                      data: base64Image,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.0,
            },
          },
          {
            headers: { "Content-Type": "application/json" },
            timeout: 90000,
          }
        ),
      "Gemini vision OCR"
    );

    const content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new GeminiApiError("Empty response from Gemini vision API", undefined, false);
    }

    const parsed = parsePlainTextResponse(content);

    appendGeminiLog(
      `RAW RESPONSE:\n${content}\n` +
        `============================================================\n`
    );

    return { fullText: parsed, source: "gemini-direct" };
  } catch (error: any) {
    appendGeminiLog(
      `ERROR: ${error.message}\n` +
        (error.response?.data ? `RESPONSE DATA: ${JSON.stringify(error.response.data)}\n` : "") +
        `============================================================\n`
    );
    throw error;
  }
}

export interface OcrResult {
  fullText: string;
  averageConfidence: number;
}

/** Vision OCR — returns literal transcribed text only (no product extraction). */
export async function detectDocumentText(imageBuffer: Buffer): Promise<OcrResult> {
  logger.info("OCR: Calling Gemini vision API...");
  const result = await callGeminiDirect(imageBuffer);
  const confidence = estimateConfidence(result.fullText);
  logger.info(
    `Gemini OCR (${result.source}): ${result.fullText.length} chars transcribed, confidence ${confidence}`
  );
  return { fullText: result.fullText, averageConfidence: confidence };
}
