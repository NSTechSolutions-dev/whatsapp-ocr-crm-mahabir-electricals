import { getStructuredData } from "../lib/claude";
import { GeminiApiError } from "../lib/gemini-retry";
import { logger } from "../utils/logger";
import { normalizeExtractedProduct } from "../utils/product-parse";
import { ExtractedRow } from "./ocr.service";

const SYSTEM_PROMPT = `You are an expert data extraction assistant for Mahabir Electricals, an Indian electrical wholesale and retail business.
You will receive raw text from a handwritten product enquiry slip, WhatsApp order message, or order form (wires, cables, switches, MCBs, fans, lights, conduits, electrical fittings, and related supplies).

Your job:
1. Parse each line as a product enquiry row with qty, unit, and rate if present.
2. Handle ditto marks (") — they mean repeat the product name from the line above.
3. The "product" field must be ONLY the item name — never include request verbs or filler words.
4. STRIP from product names: leading words like "need", "want", "please", "send", "order", "give", "require".
5. STRIP from product names: quantity numbers and unit words already captured in qty/unit fields.
6. PRESERVE in product names: size codes (A4, A5, A3), model numbers (No. 10, #10), brand names, and alphanumeric codes.
7. Normalize to clean catalogue-style names (e.g. "A4 Paper", "Magnet Pens", "Stapler Pins No. 10").
8. Extract quantity as a number and unit separately (m, metre, pcs, ream, box, etc.).
9. Extract rate/price per unit if visible in the line.
10. Assign a confidence score (0.0–1.0).
11. Return ONLY a valid JSON array. No explanation, no markdown, no code fences.

Examples:
- "Need 5 ream A4 paper" → {"raw":"Need 5 ream A4 paper","product":"A4 Paper","qty":5,"unit":"Ream","confidence":0.95}
- "10 magnet pens" → {"raw":"10 magnet pens","product":"Magnet Pens","qty":10,"unit":"Pcs","confidence":0.95}
- "1 pin box" → {"raw":"1 pin box","product":"Stapler Pins","qty":1,"unit":"Box","confidence":0.9}

Output format:
[{"raw":"original line","product":"Product Name","qty":10,"unit":"Pcs","rate":250,"confidence":0.92}]`;

export async function structureOcrText(rawText: string): Promise<ExtractedRow[]> {
  try {
    const rawResult = await getStructuredData(SYSTEM_PROMPT, `OCR Text:\n\n${rawText}\n\nReturn JSON array only.`);
    
    // Clean up markdown code blocks if any
    let cleaned = rawResult.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(json)?\n?/i, "").replace(/\n?```$/, "");
    }
    cleaned = cleaned.trim();

    const data = JSON.parse(cleaned);
    if (!Array.isArray(data)) {
      throw new Error("LLM did not return an array");
    }

    return data.map((item: any) => {
      const raw = String(item.raw || "");
      const normalized = normalizeExtractedProduct(
        String(item.product || ""),
        raw,
        Number(item.qty || 0),
        item.unit ? String(item.unit).trim() : null
      );
      return {
        raw,
        product: normalized.product,
        qty: normalized.qty,
        unit: normalized.unit,
        confidence: Number(item.confidence !== undefined ? item.confidence : 1.0),
      };
    });
  } catch (error) {
    logger.error("Failed to structure OCR text with LLM: " + error);
    return [];
  }
}

export async function classifyMessage(text: string): Promise<{ isQuotationRequest: boolean; confidence: number }> {
  const systemPrompt = `You are a text classification assistant.
Determine if the message is a product enquiry: an order list, quotation request, price inquiry, or handwritten slip with products/items, quantities, and/or rates.
This includes electrical products, wires, cables, switches, MCBs, lighting, conduits, and any merchandise order — NOT general chat.
Answer with a JSON object only. No markdown, no fences.
Format: {"isQuotationRequest": true, "confidence": 0.95}`;

  try {
    const rawResult = await getStructuredData(systemPrompt, `Message:\n\n${text}\n\nReturn JSON object only.`);
    let cleaned = rawResult.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(json)?\n?/i, "").replace(/\n?```$/, "");
    }
    cleaned = cleaned.trim();
    const data = JSON.parse(cleaned);
    return {
      isQuotationRequest: !!data.isQuotationRequest,
      confidence: Number(data.confidence !== undefined ? data.confidence : 1.0),
    };
  } catch (error) {
    logger.error("Failed to classify message: " + error);
    if (error instanceof GeminiApiError) throw error;
    throw new GeminiApiError("Message classification failed", undefined, true);
  }
}
