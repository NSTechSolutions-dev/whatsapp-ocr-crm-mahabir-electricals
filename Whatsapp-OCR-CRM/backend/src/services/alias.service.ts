import { getStructuredData } from "../lib/claude";
import { GeminiApiError } from "../lib/gemini-retry";
import { logger } from "../utils/logger";

const ALIAS_PROMPT = `You are an inventory assistant.
Given a product name, generate a list of 3-5 alternative aliases, abbreviations, common misspellings, or shorter/longer names that Indian retail or wholesale customers might write on order sheets or in WhatsApp chats.
Example:
Product: "A4 Copier Paper"
Aliases: ["a4 paper", "a4 sheet", "copier paper", "xerox paper"]

Product: "Stapler Pins No. 10"
Aliases: ["stapler pins", "pins #10", "10 number pin", "stapler pin box"]

Output ONLY a valid JSON string array of aliases. No explanation, no markdown.`;

export async function generateAliasesForProduct(productName: string): Promise<string[]> {
  const rawResult = await getStructuredData(
    ALIAS_PROMPT,
    `Product: "${productName}"\nAliases:`
  );

  let cleaned = rawResult.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(json)?\n?/i, "").replace(/\n?```$/, "");
  }
  cleaned = cleaned.trim();

  const aliases = JSON.parse(cleaned);
  if (!Array.isArray(aliases)) {
    throw new GeminiApiError("Gemini alias response was not a JSON array", undefined, false);
  }

  const normalized = aliases.map((a: any) => String(a).trim().toLowerCase()).filter(Boolean);
  if (normalized.length === 0) {
    throw new GeminiApiError("Gemini returned no aliases", undefined, true);
  }

  logger.info(`Generated ${normalized.length} alias(es) for "${productName}"`);
  return normalized;
}
