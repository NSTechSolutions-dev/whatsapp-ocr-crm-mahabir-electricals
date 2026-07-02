import { runQuotationPipeline, PipelineMatchedRow } from "./quotation-pipeline.service";
import { logger } from "../utils/logger";

export interface MatchedRow {
  raw: string;
  product: string;
  matchedName: string;
  qty: number;
  unit: string | null;
  confidence: number;
  inventoryId: string | null;
  matchType: "exact" | "alias" | "fuzzy" | "new" | "vector";
  matchScore: number;
  rate: number | null;
}

function toMatchedRow(row: PipelineMatchedRow): MatchedRow {
  return { ...row };
}

/** Extract products from raw OCR text and match against inventory using the full pipeline. */
export async function extractAndMatchProducts(rawText: string): Promise<MatchedRow[]> {
  logger.info(`extractAndMatchProducts: starting pipeline for ${rawText.length} chars`);
  const { matchedRows } = await runQuotationPipeline(rawText);
  return matchedRows.map(toMatchedRow);
}

export { runQuotationPipeline };
