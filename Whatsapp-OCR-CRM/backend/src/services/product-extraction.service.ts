import { getStructuredData } from "../lib/claude";
import { GeminiApiError } from "../lib/gemini-retry";
import { logger } from "../utils/logger";
import { stripTrailingRate } from "../utils/product-parse";
import { isAmountOnlyLine } from "../utils/order-line-prepare";

export interface ExtractedProduct {
  name: string;
  qty: number;
  raw: string;
  unit: string | null;
  rate: number | null;
  attributes?: string;
}

export class ProductExtractionError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = true) {
    super(message);
    this.name = "ProductExtractionError";
    this.retryable = retryable;
  }
}

const NON_PRODUCT_NAMES =
  /^(need|want|please|order|items?|products?|list|total|subtotal|grand\s*total|qty|quantity|description|pvc|-)$/i;

function normalizeUnit(unit: string | null | undefined): string | null {
  if (!unit) return null;
  const u = unit.trim().toLowerCase();
  if (u === "pe" || u === "pes" || u === "no" || u === "nos") return "pcs";
  if (u === "bandal" || u === "bndl") return "bundle";
  if (u === "put") return "packet";
  if (u === "m" && unit.length === 1) return "metre";
  return unit.trim();
}

function isJunkProduct(item: ExtractedProduct): boolean {
  const name = item.name.trim();
  if (name.length < 2) return true;
  if (NON_PRODUCT_NAMES.test(name)) return true;
  if (isAmountOnlyLine(name)) return true;
  if (/^[\d,.\s₹/-]+$/.test(name)) return true;
  return false;
}

function filterExtracted(products: ExtractedProduct[]): ExtractedProduct[] {
  return products.filter((p) => !isJunkProduct(p));
}

/** Single Gemini call: OCR cleanup + structured product extraction. */
const UNIFIED_EXTRACTION_PROMPT = `
You extract products from raw OCR text of Indian electrical/hardware wholesale bills and order slips.

Common layout: TWO COLUMNS — product lines on the left, line-totals/amounts on the right.
The right column contains ONLY numbers like "800/-", "120/-", "9204/-" — these are NOT products. Ignore them.

Parsing rules:
- "NO" / "NOS" -> unit pcs
- "put" -> packet, "coil" -> coil, "6M" on tape -> metre
- Keep specs in name: 4way, 3way, 6A, 32AMP, 2.5 mm, 0.75 sq mm
- "AFTAK" -> aftak switch, wire brand lines -> include brand + gauge
- "rate" is per-unit price from "160/-" style suffix, NOT the right-column line total
- Merge split lines: "Gold medal" + "wire (H)" -> one wire product
- REMOVE: grand totals, dates, shop headers, amount-only columns, empty lines

Return ONLY a valid JSON array. Each object:
{
  "name": "full product name lowercase with specs",
  "qty": number,
  "unit": "pcs|coil|metre|packet|box|null",
  "rate": number or null,
  "raw": "exact source OCR line for this item",
  "attributes": "optional notes"
}

Rules:
- "raw" MUST match the source line — never shift lines between products.
- Valid JSON array only. No markdown. No explanation.
`;

function parseExtractionResponse(raw: string, sourceText: string): ExtractedProduct[] {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(json)?\n?/i, "").replace(/\n?```$/, "");
  }
  cleaned = cleaned.trim();

  const data = JSON.parse(cleaned);
  if (!Array.isArray(data)) {
    throw new ProductExtractionError("Gemini did not return a JSON array", false);
  }

  const sourceLines = sourceText
    .split(/[\n\r]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  return data
    .map((item: any, index: number) => {
      const name = String(item.name || item.product || "").trim().toLowerCase();
      const qty = Number(item.qty) > 0 ? Number(item.qty) : 1;
      let rawLine = String(item.raw || sourceLines[index] || name).trim();
      const unit = normalizeUnit(item.unit ? String(item.unit) : null);
      const rate =
        item.rate !== undefined && item.rate !== null && item.rate !== ""
          ? Number(item.rate)
          : stripTrailingRate(rawLine).rate;
      const attributes = item.attributes ? String(item.attributes).trim() : undefined;
      return { name, qty, raw: rawLine, unit, rate: Number.isFinite(rate) ? rate : null, attributes };
    })
    .filter((item: ExtractedProduct) => item.name.length >= 2);
}

/** One Gemini call: extract products from prepared OCR text. */
export async function extractProducts(preparedOcrText: string): Promise<ExtractedProduct[]> {
  const text = (preparedOcrText || "").trim();
  if (!text) return [];

  try {
    logger.info("Executing unified Gemini product extraction...");
    const rawResult = await getStructuredData(
      UNIFIED_EXTRACTION_PROMPT,
      `Order text:\n\n${text}\n\nReturn JSON array only.`
    );

    const extracted = filterExtracted(parseExtractionResponse(rawResult, text));
    logger.info(`Product extraction: ${extracted.length} product(s)`);
    return extracted;
  } catch (error: any) {
    if (error instanceof ProductExtractionError) throw error;
    if (error instanceof GeminiApiError) {
      throw new ProductExtractionError(error.message, error.retryable);
    }
    throw new ProductExtractionError(error?.message || "Product extraction failed", false);
  }
}
