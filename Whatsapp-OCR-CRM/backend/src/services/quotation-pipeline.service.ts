import { verifyInventoryMatch } from "./ai-verification.service";
import { getCachedMatch, setCachedMatch } from "./match-cache.service";
import { extractProducts, ExtractedProduct } from "./product-extraction.service";
import { buildQuotationModel, QuotationModel } from "./quotation-model.service";
import { searchInventory } from "./inventory-search.service";
import { InventorySearchRow } from "../repositories/inventory.repository";
import { findClosestVectorMatchWithInventory } from "../repositories/embedding.repository";
import { logger } from "../utils/logger";
import { normalizeProductText, formatProductName } from "../utils/product-normalize";
import { meetsConfidenceThreshold, meetsEmbeddingThreshold, EMBEDDING_MATCH_THRESHOLD } from "../config/matching";
import { embedQueryCached, embedTextsKeyed, embeddingDbReady } from "./embedding.service";
import { prisma } from "../lib/prisma";
import { prepareOcrText } from "../utils/order-line-prepare";
import { shouldRejectMatch, hasProductNoun } from "../utils/match-validation";
import { env } from "../config/env";
import { getLearnedMatch } from "./learning.service";

export { MATCH_CONFIDENCE_THRESHOLD, meetsConfidenceThreshold } from "../config/matching";

export interface PipelineMatchedRow {
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

export interface QuotationPipelineResult {
  matchedRows: PipelineMatchedRow[];
  quotation: QuotationModel;
  stats: {
    extracted: number;
    cacheHits: number;
    sqlMatches: number;
    aiVerified: number;
    unmatched: number;
    embeddingMatches: number;
    embeddingApiCalls: number;
    learningHits: number;
  };
}

export interface ProductMatchInput {
  name: string;
  qty?: number;
  unit?: string | null;
  raw?: string;
  rate?: number | null;
}

function resolveMatchType(candidate: InventorySearchRow): "exact" | "alias" | "fuzzy" {
  if (candidate.nameScore >= 0.95 || candidate.score >= 0.95) return "exact";
  if (candidate.aliasScore >= candidate.nameScore && candidate.aliasScore >= 0.5) return "alias";
  return "fuzzy";
}

function emptyStats(): QuotationPipelineResult["stats"] {
  return {
    extracted: 0,
    cacheHits: 0,
    sqlMatches: 0,
    aiVerified: 0,
    unmatched: 0,
    embeddingMatches: 0,
    embeddingApiCalls: 0,
    learningHits: 0,
  };
}

const MATCH_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

async function resolveUnitRate(
  inventoryId: string,
  requestedUnit: string | null,
  defaultRate: number | null
): Promise<{ unit: string | null; rate: number | null }> {
  if (!requestedUnit) {
    return { unit: null, rate: defaultRate };
  }
  const normUnit = requestedUnit.trim().toLowerCase();
  try {
    const unitRate = await prisma.inventoryUnitRate.findFirst({
      where: {
        inventoryId,
        unit: {
          equals: normUnit,
          mode: "insensitive",
        },
      },
    });
    if (unitRate) {
      return { unit: unitRate.unit, rate: unitRate.rate };
    }
  } catch (error) {
    logger.warn(`Failed to resolve unit rate for inventory ${inventoryId} and unit ${requestedUnit}: ${error}`);
  }
  return { unit: requestedUnit, rate: defaultRate };
}

function unmatchedRow(
  raw: string,
  name: string,
  qty: number,
  unitHint: string | null,
  matchScore = 0,
  rate: number | null = null
): PipelineMatchedRow {
  const displayName = formatProductName(name);
  return {
    raw,
    product: displayName,
    matchedName: displayName,
    qty,
    unit: unitHint,
    confidence: 0,
    inventoryId: null,
    matchType: "new",
    matchScore,
    rate,
  };
}

async function buildMatchedRow(
  raw: string,
  product: string,
  inventoryId: string,
  matchedName: string,
  qty: number,
  unitHint: string | null,
  defaultUnit: string | null,
  defaultRate: number | null,
  confidence: number,
  matchType: PipelineMatchedRow["matchType"]
): Promise<PipelineMatchedRow> {
  const rateInfo = await resolveUnitRate(inventoryId, unitHint, defaultRate);
  return {
    raw,
    product,
    matchedName,
    qty,
    unit: rateInfo.unit || defaultUnit || unitHint,
    confidence,
    inventoryId,
    matchType,
    matchScore: confidence,
    rate: rateInfo.rate,
  };
}

async function selectCandidate(
  name: string,
  candidates: InventorySearchRow[],
  stats: QuotationPipelineResult["stats"]
): Promise<InventorySearchRow | null> {
  const pool = candidates.filter((c) => !shouldRejectMatch(name, c.name, c.score));
  if (pool.length === 0) return null;

  const top = pool[0];

  if (top.score >= 0.92) {
    stats.sqlMatches++;
    logger.info(`High-confidence match "${name}" → "${top.name}" (score=${top.score.toFixed(3)})`);
    return top;
  }

  if (pool.length === 1 && meetsConfidenceThreshold(top.score)) {
    stats.sqlMatches++;
    logger.info(`Single-candidate match "${name}" → "${top.name}" (score=${top.score.toFixed(3)})`);
    return top;
  }

  const verifiedId = await verifyInventoryMatch(name, pool);
  if (verifiedId) {
    const selected = pool.find((c) => c.id === verifiedId) || null;
    if (selected) {
      stats.aiVerified++;
      logger.info(`AI-verified match "${name}" → "${selected.name}" (score=${selected.score.toFixed(3)})`);
      return selected;
    }
  }

  return null;
}

interface VectorPending {
  input: ProductMatchInput;
  normalized: string;
  trigramBestScore: number;
}

async function resolveVectorMatch(
  name: string,
  vector: number[] | null,
  stats: QuotationPipelineResult["stats"]
): Promise<InventorySearchRow | null> {
  if (!vector) return null;

  const matches = await findClosestVectorMatchWithInventory(vector, 5);
  if (matches.length === 0 || !meetsEmbeddingThreshold(matches[0].similarity)) {
    return null;
  }

  const candidates: InventorySearchRow[] = [];
  for (const match of matches) {
    if (!meetsEmbeddingThreshold(match.similarity)) continue;
    if (shouldRejectMatch(name, match.name, match.similarity)) continue;
    candidates.push({
      id: match.inventoryId,
      name: match.name,
      unit: match.unit,
      rate: match.rate,
      score: match.similarity,
      nameScore: match.similarity,
      aliasScore: 0,
      unitScore: 0,
    });
  }

  if (candidates.length === 0) return null;

  const top = candidates[0];
  if (top.score >= EMBEDDING_MATCH_THRESHOLD && candidates.length === 1) {
    stats.embeddingMatches++;
    logger.info(`Vector auto-match "${name}" → "${top.name}" (sim=${top.score.toFixed(3)})`);
    return top;
  }

  const verifiedId = await verifyInventoryMatch(name, candidates);
  if (!verifiedId) return null;

  const selected = candidates.find((c) => c.id === verifiedId) || null;
  if (selected) {
    stats.embeddingMatches++;
    logger.info(`Vector+AI match "${name}" → "${selected.name}" (sim=${selected.score.toFixed(3)})`);
  }
  return selected;
}

async function matchProductPreVector(
  input: ProductMatchInput,
  stats: QuotationPipelineResult["stats"]
): Promise<{ row: PipelineMatchedRow } | { pending: VectorPending }> {
  const name = (input.name || "").trim();
  const qty = input.qty && input.qty > 0 ? input.qty : 1;
  const unitHint = input.unit || null;
  const raw = input.raw || name;
  const extractedRate = input.rate ?? null;
  const normalized = normalizeProductText(name);

  if (!normalized) {
    stats.unmatched++;
    return { row: unmatchedRow(raw, name, qty, unitHint, 0, extractedRate) };
  }

  const learned = await getLearnedMatch(name, raw);
  if (learned) {
    if (shouldRejectMatch(name, learned.name, 0.98)) {
      logger.warn(`Rejected learned false positive "${name}" → "${learned.name}"`);
    } else {
      stats.learningHits++;
      const rateInfo = await resolveUnitRate(learned.inventoryId, unitHint, learned.rate);
      await setCachedMatch(normalized, learned.inventoryId, 0.98, "alias");
      return {
        row: {
          raw,
          product: name,
          matchedName: learned.name,
          qty,
          unit: rateInfo.unit || learned.unit || unitHint,
          confidence: 0.98,
          inventoryId: learned.inventoryId,
          matchType: "alias",
          matchScore: 0.98,
          rate: rateInfo.rate ?? extractedRate,
        },
      };
    }
  }

  const cached = await getCachedMatch(normalized);
  if (cached) {
    if (shouldRejectMatch(name, cached.name, cached.matchScore)) {
      logger.warn(`Rejected cached false positive "${name}" → "${cached.name}"`);
    } else {
      stats.cacheHits++;
      const rateInfo = await resolveUnitRate(cached.inventoryId, unitHint, cached.rate);
      return {
        row: {
          raw,
          product: name,
          matchedName: cached.name,
          qty,
          unit: rateInfo.unit || cached.unit || unitHint,
          confidence: cached.matchScore,
          inventoryId: cached.inventoryId,
          matchType: cached.matchType,
          matchScore: cached.matchScore,
          rate: rateInfo.rate,
        },
      };
    }
  }

  const candidates = await searchInventory(normalized, unitHint, 10);

  let selected = await selectCandidate(name, candidates, stats);

  if (!selected) {
    if (env.EMBEDDING_ENABLED && embeddingDbReady && hasProductNoun(name)) {
      return {
        pending: {
          input,
          normalized,
          trigramBestScore: candidates[0]?.score ?? 0,
        },
      };
    }
    stats.unmatched++;
    return { row: unmatchedRow(raw, name, qty, unitHint, candidates[0]?.score ?? 0, extractedRate) };
  }

  const matchType = resolveMatchType(selected);
  await setCachedMatch(normalized, selected.id, selected.score, matchType, {
    id: selected.id,
    name: selected.name,
    unit: selected.unit,
    currentRate: selected.rate,
  });
  const rateInfo = await resolveUnitRate(selected.id, unitHint, selected.rate ?? extractedRate);

  return {
    row: {
      raw,
      product: name,
      matchedName: selected.name,
      qty,
      unit: rateInfo.unit || selected.unit || unitHint,
      confidence: selected.score,
      inventoryId: selected.id,
      matchType,
      matchScore: selected.score,
      rate: rateInfo.rate,
    },
  };
}

async function finalizeVectorPending(
  pending: VectorPending,
  vector: number[] | undefined,
  stats: QuotationPipelineResult["stats"]
): Promise<PipelineMatchedRow> {
  const { input } = pending;
  const name = (input.name || "").trim();
  const qty = input.qty && input.qty > 0 ? input.qty : 1;
  const unitHint = input.unit || null;
  const raw = input.raw || name;
  const extractedRate = input.rate ?? null;

  const selected = await resolveVectorMatch(name, vector ?? null, stats);
  if (!selected) {
    stats.unmatched++;
    return unmatchedRow(raw, name, qty, unitHint, pending.trigramBestScore, extractedRate);
  }

  const matchType: PipelineMatchedRow["matchType"] = "vector";
  await setCachedMatch(pending.normalized, selected.id, selected.score, matchType, {
    id: selected.id,
    name: selected.name,
    unit: selected.unit,
    currentRate: selected.rate,
  });
  const rateInfo = await resolveUnitRate(selected.id, unitHint, selected.rate ?? extractedRate);

  return {
    raw,
    product: name,
    matchedName: selected.name,
    qty,
    unit: rateInfo.unit || selected.unit || unitHint,
    confidence: selected.score,
    inventoryId: selected.id,
    matchType,
    matchScore: selected.score,
    rate: rateInfo.rate,
  };
}

async function matchSingleProduct(
  input: ProductMatchInput,
  stats: QuotationPipelineResult["stats"]
): Promise<PipelineMatchedRow> {
  const pre = await matchProductPreVector(input, stats);
  if ("row" in pre) return pre.row;

  const name = (input.name || "").trim();
  let vector: number[] | undefined;
  try {
    const embedResult = await embedQueryCached(name);
    vector = embedResult.vector ?? undefined;
    if (!embedResult.cacheHit) stats.embeddingApiCalls++;
  } catch (error: any) {
    logger.warn(`Vector embed skipped for "${name}": ${error?.message || error}`);
  }

  return finalizeVectorPending(pre.pending, vector, stats);
}

export async function matchProductViaPipeline(input: ProductMatchInput): Promise<PipelineMatchedRow> {
  return matchSingleProduct(input, emptyStats());
}

function toMatchInput(item: ExtractedProduct): ProductMatchInput {
  const name = item.attributes ? `${item.name} ${item.attributes}`.trim() : item.name;
  return {
    name,
    qty: item.qty,
    unit: item.unit,
    raw: item.raw,
    rate: item.rate,
  };
}

/**
 * OCR pipeline: prepare lines → LLM extraction → verified trigram/vector matching.
 */
export async function runQuotationPipeline(rawOcrText: string): Promise<QuotationPipelineResult> {
  const stats = emptyStats();

  const preparedText = prepareOcrText(rawOcrText);
  logger.info(`Pipeline: LLM extraction on ${preparedText.split("\n").length} prepared line(s)`);

  const extracted = await extractProducts(preparedText);
  stats.extracted = extracted.length;

  const preResults = await mapWithConcurrency(extracted, MATCH_CONCURRENCY, (item) =>
    matchProductPreVector(toMatchInput(item), stats)
  );

  const matchedRows: PipelineMatchedRow[] = new Array(extracted.length);
  const vectorPending: { index: number; pending: VectorPending }[] = [];

  preResults.forEach((pre, index) => {
    if ("row" in pre) {
      matchedRows[index] = pre.row;
    } else {
      vectorPending.push({ index, pending: pre.pending });
    }
  });

  if (vectorPending.length > 0) {
    if (env.EMBEDDING_ENABLED && embeddingDbReady) {
      const names = vectorPending
        .map((p) => (p.pending.input.name || "").trim())
        .filter(Boolean);
      const { vectors, apiCalls } = await embedTextsKeyed(names);
      stats.embeddingApiCalls += apiCalls;

      await mapWithConcurrency(vectorPending, MATCH_CONCURRENCY, async ({ index, pending }) => {
        const name = (pending.input.name || "").trim();
        matchedRows[index] = await finalizeVectorPending(pending, vectors.get(name), stats);
      });
    } else {
      for (const { index, pending } of vectorPending) {
        const name = (pending.input.name || "").trim();
        const qty = pending.input.qty && pending.input.qty > 0 ? pending.input.qty : 1;
        stats.unmatched++;
        matchedRows[index] = unmatchedRow(
          pending.input.raw || name,
          name,
          qty,
          pending.input.unit || null,
          pending.trigramBestScore,
          pending.input.rate ?? null
        );
      }
    }
  }

  const quotation = buildQuotationModel(
    matchedRows.map((row) => ({
      inventoryId: row.inventoryId,
      name: row.matchedName,
      unit: row.unit,
      qty: row.qty,
      rate: row.rate,
    }))
  );

  logger.info(
    `Pipeline complete: extracted=${stats.extracted} learned=${stats.learningHits} embeddings=${stats.embeddingMatches} cache=${stats.cacheHits} sql=${stats.sqlMatches} ai=${stats.aiVerified} new=${stats.unmatched} subtotal=${quotation.subtotal}`
  );

  return { matchedRows, quotation, stats };
}
