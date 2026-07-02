import { LearnedMappingSource } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { queueProductEmbedding } from "../jobs/embed-product.job";
import { setCachedMatch } from "./match-cache.service";
import { syncInventorySearchText } from "./inventory.service";
import { findInventoryById } from "../repositories/inventory.repository";
import { logger } from "../utils/logger";
import {
  buildInventorySearchText,
  deriveAliasesFromRaw,
  normalizeAliasList,
  normalizeProductText,
  sanitizeAlias,
} from "../utils/product-normalize";
import { LEARNING_MIN_HITS, learningEnabled } from "../config/learning";

export type LearningSource = "FINALIZE" | "MANUAL_EDIT" | "AUTO_CONFIRMED";

export interface LearnedMatchResult {
  inventoryId: string;
  name: string;
  unit: string | null;
  rate: number | null;
  hitCount: number;
  lookupKind: "raw" | "name";
}

function toPrismaSource(source: LearningSource): LearnedMappingSource {
  return source as LearnedMappingSource;
}

function buildLookupKey(text: string, kind: "raw" | "name"): string | null {
  const cleaned = kind === "raw" ? sanitizeAlias(text) : normalizeProductText(text);
  if (!cleaned) return null;
  return normalizeProductText(cleaned);
}

/** Look up a durable mapping learned from prior enquiries. */
export async function getLearnedMatch(
  productName: string,
  rawText?: string | null
): Promise<LearnedMatchResult | null> {
  if (!learningEnabled()) return null;

  const keys: { key: string; kind: "raw" | "name" }[] = [];
  if (rawText?.trim()) {
    const rawKey = buildLookupKey(rawText, "raw");
    if (rawKey) keys.push({ key: rawKey, kind: "raw" });
  }
  const nameKey = buildLookupKey(productName, "name");
  if (nameKey) keys.push({ key: nameKey, kind: "name" });

  for (const { key, kind } of keys) {
    const row = await prisma.learnedMapping.findUnique({
      where: { lookupKey_lookupKind: { lookupKey: key, lookupKind: kind } },
    });
    if (!row || row.hitCount < LEARNING_MIN_HITS) continue;

    const inv = await findInventoryById(row.inventoryId);
    if (!inv) continue;

    logger.debug(`Learned match [${kind}] "${key}" → "${inv.name}" (hits=${row.hitCount})`);
    return {
      inventoryId: inv.id,
      name: inv.name,
      unit: inv.unit,
      rate: inv.currentRate,
      hitCount: row.hitCount,
      lookupKind: kind,
    };
  }

  return null;
}

async function upsertLearnedMapping(
  lookupKey: string,
  lookupKind: "raw" | "name",
  inventoryId: string,
  source: LearningSource,
  enquiryId?: string
): Promise<void> {
  const existing = await prisma.learnedMapping.findUnique({
    where: { lookupKey_lookupKind: { lookupKey, lookupKind } },
  });

  if (!existing) {
    await prisma.learnedMapping.create({
      data: {
        lookupKey,
        lookupKind,
        inventoryId,
        source: toPrismaSource(source),
        hitCount: 1,
        lastEnquiryId: enquiryId ?? null,
      },
    });
    return;
  }

  const sameInventory = existing.inventoryId === inventoryId;

  if (sameInventory) {
    await prisma.learnedMapping.update({
      where: { id: existing.id },
      data: {
        hitCount: existing.hitCount + 1,
        source: toPrismaSource(source),
        lastEnquiryId: enquiryId ?? existing.lastEnquiryId,
      },
    });
    return;
  }

  // Different inventory — finalize is authoritative; manual edit starts a new tentative mapping
  const adoptNew =
    source === "FINALIZE" || source === "AUTO_CONFIRMED" || existing.hitCount <= 1;

  if (adoptNew) {
    await prisma.learnedMapping.update({
      where: { id: existing.id },
      data: {
        inventoryId,
        hitCount: source === "FINALIZE" ? existing.hitCount + 1 : 1,
        source: toPrismaSource(source),
        lastEnquiryId: enquiryId ?? existing.lastEnquiryId,
      },
    });
  } else {
    logger.info(
      `Learned mapping conflict for "${lookupKey}" (${lookupKind}): keeping ${existing.inventoryId} (${existing.hitCount} hits), ignored ${inventoryId}`
    );
  }
}

/** Merge OCR-derived aliases into inventory and refresh search/embeddings. */
async function applyAliasLearning(
  inventoryId: string,
  productName: string,
  rawText?: string | null
): Promise<void> {
  const inv = await prisma.inventory.findUnique({ where: { id: inventoryId } });
  if (!inv) return;

  const newAliases = deriveAliasesFromRaw(productName, rawText);
  if (newAliases.length === 0) return;

  const merged = normalizeAliasList(inv.name, [...inv.aliases, ...newAliases]);
  if (JSON.stringify(merged) === JSON.stringify(inv.aliases)) return;

  await prisma.inventory.update({
    where: { id: inventoryId },
    data: {
      aliases: merged,
      searchText: buildInventorySearchText(inv.name, merged, inv.unit),
    },
  });

  await syncInventorySearchText(inventoryId, inv.name, merged, inv.unit);
  await queueProductEmbedding({ inventoryId, name: inv.name, aliases: merged });
  logger.info(`Learning: added alias(es) to "${inv.name}" from enquiry OCR`);
}

/** Record a confirmed product mapping from an enquiry line. */
export async function learnFromItem(input: {
  productName: string;
  rawText?: string | null;
  inventoryId: string;
  source: LearningSource;
  enquiryId?: string;
}): Promise<void> {
  if (!learningEnabled() || !input.inventoryId) return;

  const inv = await findInventoryById(input.inventoryId);
  if (!inv) return;

  const keys: { key: string; kind: "raw" | "name" }[] = [];
  if (input.rawText?.trim()) {
    const rawKey = buildLookupKey(input.rawText, "raw");
    if (rawKey) keys.push({ key: rawKey, kind: "raw" });
  }
  const nameKey = buildLookupKey(input.productName, "name");
  if (nameKey && !keys.some((k) => k.key === nameKey)) {
    keys.push({ key: nameKey, kind: "name" });
  }

  for (const { key, kind } of keys) {
    await upsertLearnedMapping(key, kind, input.inventoryId, input.source, input.enquiryId);
    await setCachedMatch(key, input.inventoryId, 0.98, "alias");
  }

  await applyAliasLearning(input.inventoryId, input.productName, input.rawText);
}

/** Learn from all mapped items on a finalized enquiry. */
export async function learnFromEnquiry(enquiryId: string, source: LearningSource = "FINALIZE"): Promise<number> {
  if (!learningEnabled()) return 0;

  const items = await prisma.enquiryItem.findMany({
    where: { enquiryId, inventoryId: { not: null } },
  });

  let learned = 0;
  for (const item of items) {
    if (!item.inventoryId) continue;
    await learnFromItem({
      productName: item.productName,
      rawText: item.rawText,
      inventoryId: item.inventoryId,
      source,
      enquiryId,
    });
    learned++;
  }

  if (learned > 0) {
    logger.info(`Learning: recorded ${learned} mapping(s) from enquiry ${enquiryId} (${source})`);
  }
  return learned;
}

interface ItemSnapshot {
  rawText?: string | null;
  productName?: string;
  inventoryId?: string | null;
  autoInventoryId?: string | null;
}

/** Learn when staff corrects inventory mapping before finalize. */
export async function learnFromCorrections(
  enquiryId: string,
  before: ItemSnapshot[],
  after: ItemSnapshot[]
): Promise<void> {
  if (!learningEnabled()) return;

  for (const newItem of after) {
    if (!newItem.inventoryId || !newItem.productName?.trim()) continue;

    const key = (newItem.rawText || newItem.productName).trim().toLowerCase();
    const prev = before.find(
      (b) =>
        (b.rawText || b.productName || "").trim().toLowerCase() === key ||
        (b.productName || "").trim().toLowerCase() === newItem.productName!.trim().toLowerCase()
    );

    const wasCorrected =
      prev &&
      (prev.inventoryId !== newItem.inventoryId ||
        ((prev.autoInventoryId ?? newItem.autoInventoryId) &&
          (prev.autoInventoryId ?? newItem.autoInventoryId) !== newItem.inventoryId));

    const isNewMapping = !prev?.inventoryId && newItem.inventoryId;

    if (wasCorrected || isNewMapping) {
      await learnFromItem({
        productName: newItem.productName,
        rawText: newItem.rawText,
        inventoryId: newItem.inventoryId,
        source: "MANUAL_EDIT",
        enquiryId,
      });
    }
  }
}

/** Stats for admin/debug dashboards. */
export async function getLearningStats() {
  const [total, bySource, topMappings] = await Promise.all([
    prisma.learnedMapping.count(),
    prisma.learnedMapping.groupBy({
      by: ["source"],
      _count: { id: true },
    }),
    prisma.learnedMapping.findMany({
      orderBy: { hitCount: "desc" },
      take: 20,
      include: { inventory: { select: { name: true } } },
    }),
  ]);

  return {
    total,
    bySource: bySource.map((r) => ({ source: r.source, count: r._count.id })),
    topMappings: topMappings.map((m) => ({
      lookupKey: m.lookupKey,
      lookupKind: m.lookupKind,
      inventoryName: m.inventory.name,
      hitCount: m.hitCount,
      source: m.source,
    })),
  };
}
