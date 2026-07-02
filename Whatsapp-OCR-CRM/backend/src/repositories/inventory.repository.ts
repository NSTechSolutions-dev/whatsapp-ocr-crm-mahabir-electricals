import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";
import { normalizeProductText } from "../utils/product-normalize";

export interface InventorySearchRow {
  id: string;
  name: string;
  unit: string | null;
  rate: number | null;
  score: number;
  nameScore: number;
  aliasScore: number;
  unitScore: number;
}

const NAME_WEIGHT = 0.5;
const ALIAS_WEIGHT = 0.35;
const UNIT_WEIGHT = 0.15;

/** Case-insensitive exact match on product name or alias. */
export async function findExactInventoryMatch(
  normalizedQuery: string
): Promise<InventorySearchRow | null> {
  const query = normalizeProductText(normalizedQuery || "");
  if (!query) return null;

  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT
        i.id,
        i.name,
        i.unit,
        i."currentRate" AS rate,
        (lower(i.name) = ${query}) AS is_name_match
      FROM "Inventory" i
      WHERE lower(i.name) = ${query}
         OR EXISTS (
           SELECT 1 FROM unnest(i.aliases) AS a
           WHERE lower(trim(a)) = ${query}
         )
      LIMIT 1
    `;

    if (rows.length === 0) return null;

    const row = rows[0];
    const isNameMatch = row.is_name_match === true;
    return {
      id: row.id as string,
      name: row.name as string,
      unit: (row.unit as string | null) ?? null,
      rate: row.rate != null ? parseFloat(String(row.rate)) : null,
      score: 1,
      nameScore: isNameMatch ? 1 : 0,
      aliasScore: isNameMatch ? 0 : 1,
      unitScore: 0,
    };
  } catch (error) {
    logger.error(`Exact inventory match failed for "${query}": ${error}`);
    return null;
  }
}

export async function searchTopCandidates(
  normalizedQuery: string,
  unitHint: string | null = null,
  limit: number = 10
): Promise<InventorySearchRow[]> {
  const query = normalizeProductText(normalizedQuery || "");
  if (!query) return [];

  const normalizedUnit = unitHint ? normalizeProductText(unitHint) : "";

  try {
    const rows: any[] = await prisma.$queryRaw`
      SELECT
        i.id,
        i.name,
        i.unit,
        i."currentRate" AS rate,
        similarity(lower(i.name), ${query}) AS name_sim,
        COALESCE(
          (SELECT MAX(similarity(lower(trim(a)), ${query})) FROM unnest(i.aliases) AS a),
          0
        ) AS alias_sim,
        COALESCE(similarity(lower(COALESCE(i.unit, '')), ${normalizedUnit}), 0) AS unit_sim,
        (
          ${NAME_WEIGHT} * similarity(lower(i.name), ${query})
          + ${ALIAS_WEIGHT} * COALESCE(
              (SELECT MAX(similarity(lower(trim(a)), ${query})) FROM unnest(i.aliases) AS a),
              0
            )
          + ${UNIT_WEIGHT} * COALESCE(similarity(lower(COALESCE(i.unit, '')), ${normalizedUnit}), 0)
        ) AS score
      FROM "Inventory" i
      WHERE i."search_text" IS NOT NULL
        AND i."search_text" % ${query}
      ORDER BY score DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => {
      const nameScore = parseFloat(row.name_sim ?? "0");
      const aliasScore = parseFloat(row.alias_sim ?? "0");
      const unitScore = parseFloat(row.unit_sim ?? "0");
      const score = parseFloat(row.score ?? "0");

      return {
        id: row.id as string,
        name: row.name as string,
        unit: (row.unit as string | null) ?? null,
        rate: row.rate != null ? parseFloat(String(row.rate)) : null,
        score,
        nameScore,
        aliasScore,
        unitScore,
      };
    });
  } catch (error) {
    logger.error(`Inventory search failed for "${query}": ${error}`);
    return [];
  }
}

export async function findInventoryById(id: string) {
  return prisma.inventory.findUnique({
    where: { id },
    select: { id: true, name: true, unit: true, currentRate: true },
  });
}
