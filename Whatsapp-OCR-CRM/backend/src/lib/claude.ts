import axios from "axios";
import fs from "fs/promises";
import path from "path";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { GeminiApiError, withGeminiBackoff } from "./gemini-retry";

const GEMINI_TEXT_MODEL = env.GEMINI_TEXT_MODEL;
const LOG_ENABLED = env.NODE_ENV === "development";

function requireGeminiKey(): string {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey || apiKey.includes("placeholder")) {
    throw new GeminiApiError("GEMINI_API_KEY is not configured", undefined, false);
  }
  return apiKey;
}

function appendGeminiLog(chunk: string): void {
  if (!LOG_ENABLED) return;
  const logFilePath = path.join(process.cwd(), "logs", "gemini_io.log");
  void fs.mkdir(path.dirname(logFilePath), { recursive: true })
    .then(() => fs.appendFile(logFilePath, chunk, "utf8"))
    .catch(() => {});
}

async function callGeminiDirectText(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = requireGeminiKey();

  appendGeminiLog(
    `\n=== GEMINI DIRECT TEXT CALL ${new Date().toISOString()} ===\n` +
      `SYSTEM PROMPT:\n${systemPrompt}\n` +
      `USER PROMPT:\n${userPrompt}\n` +
      `----------------------------------------\n`
  );

  const requestBody = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
    },
  };

  try {
    const response = await withGeminiBackoff(
      () =>
        axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${apiKey}`,
          requestBody,
          {
            headers: { "Content-Type": "application/json" },
            timeout: 60000,
          }
        ),
      "Gemini text"
    );

    const content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new GeminiApiError("Empty response from Gemini API", undefined, false);
    }

    appendGeminiLog(
      `RAW RESPONSE:\n${content}\n` +
        `============================================================\n`
    );

    return content;
  } catch (error: any) {
    appendGeminiLog(
      `ERROR: ${error.message}\n` +
        (error.response?.data ? `RESPONSE DATA: ${JSON.stringify(error.response.data)}\n` : "") +
        `============================================================\n`
    );
    throw error;
  }
}

export async function getStructuredData(systemPrompt: string, userPrompt: string): Promise<string> {
  logger.info("LLM: Querying Gemini API...");
  return callGeminiDirectText(systemPrompt, userPrompt);
}
