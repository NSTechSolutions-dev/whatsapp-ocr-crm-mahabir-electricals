import { getBuffer } from "../lib/s3";
import { detectDocumentText } from "../lib/gcv";
import { extractAndMatchProducts } from "./matching.service";
import { logger } from "../utils/logger";

export interface ExtractedRow {
  raw: string;
  product: string;
  qty: number;
  unit: string | null;
  confidence: number;
}

export async function processOcrImage(s3Key: string): Promise<{ rows: ExtractedRow[]; rawText: string; confidence: number }> {
  try {
    logger.info(`Starting OCR processing for S3 key: ${s3Key}`);
    const buffer = await getBuffer(s3Key);

    const { fullText, averageConfidence } = await detectDocumentText(buffer);

    if (!fullText.trim()) {
      logger.warn(`No text detected in S3 image: ${s3Key}`);
      return { rows: [], rawText: "", confidence: 0 };
    }

    const matched = await extractAndMatchProducts(fullText);
    const rows: ExtractedRow[] = matched.map((row) => ({
      raw: row.raw,
      product: row.matchedName || row.product,
      qty: row.qty,
      unit: row.unit,
      confidence: row.confidence,
    }));

    return {
      rows,
      rawText: fullText,
      confidence: averageConfidence,
    };
  } catch (error) {
    logger.error(`Error in processOcrImage for ${s3Key}: ${error}`);
    throw error;
  }
}
