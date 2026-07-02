import { matchProductViaPipeline } from "./quotation-pipeline.service";
import { logger } from "../utils/logger";
import { buildInventorySearchText } from "../utils/product-normalize";
import { searchTopCandidates } from "../repositories/inventory.repository";
import { prisma } from "../lib/prisma";

export interface MatchResult {
  inventoryId: string | null;
  productName: string;
  currentRate: number | null;
  unit: string | null;
  matchType: "exact" | "alias" | "fuzzy" | "new" | "vector";
  matchScore: number;
}

export async function syncInventorySearchText(
  id: string,
  name: string,
  aliases: string[],
  unit: string | null
): Promise<void> {
  const searchText = buildInventorySearchText(name, aliases, unit);
  await prisma.inventory.update({
    where: { id },
    data: { searchText },
  });
}

/** Match a product using the full pipeline (cache + weighted search + AI verify). */
export async function matchProduct(input: string, unitHint?: string | null): Promise<MatchResult> {
  const name = (input || "").trim();
  if (!name) {
    return {
      inventoryId: null,
      productName: name,
      currentRate: null,
      unit: null,
      matchType: "new",
      matchScore: 0.0,
    };
  }

  try {
    const row = await matchProductViaPipeline({ name, unit: unitHint ?? null, raw: name });
    return {
      inventoryId: row.inventoryId,
      productName: row.matchedName || name,
      currentRate: row.rate,
      unit: row.unit,
      matchType: row.matchType,
      matchScore: row.matchScore,
    };
  } catch (error) {
    logger.error(`Error matching product ${name}: ${error}`);
    return {
      inventoryId: null,
      productName: name,
      currentRate: null,
      unit: null,
      matchType: "new",
      matchScore: 0.0,
    };
  }
}

export async function searchInventory(query: string, limit: number = 10): Promise<any[]> {
  try {
    const q = (query || "").trim();
    if (!q) {
      return prisma.inventory.findMany({ take: limit, include: { unitRates: true } });
    }

    const results = await searchTopCandidates(q, null, limit);
    const ids = results.map((r) => r.id);
    const itemsWithRates = await prisma.inventory.findMany({
      where: { id: { in: ids } },
      include: { unitRates: true },
    });

    return results.map((r) => {
      const dbItem = itemsWithRates.find((item) => item.id === r.id);
      return {
        id: r.id,
        name: r.name,
        currentRate: r.rate,
        unit: r.unit,
        sim: r.score,
        unitRates: dbItem ? dbItem.unitRates : [],
      };
    });
  } catch (error) {
    logger.error(`Error searching inventory for "${query}": ${error}`);
    return [];
  }
}

export async function deleteInventoryItem(id: string): Promise<void> {
  await prisma.$transaction([
    prisma.enquiryItem.updateMany({ where: { inventoryId: id }, data: { inventoryId: null } }),
    prisma.rateHistory.deleteMany({ where: { inventoryId: id } }),
    prisma.inventory.delete({ where: { id } }),
  ]);
}

export async function clearAllInventory(): Promise<number> {
  const count = await prisma.inventory.count();
  await prisma.$transaction([
    prisma.enquiryItem.updateMany({ where: { inventoryId: { not: null } }, data: { inventoryId: null } }),
    prisma.rateHistory.deleteMany(),
    prisma.inventory.deleteMany(),
  ]);
  return count;
}
