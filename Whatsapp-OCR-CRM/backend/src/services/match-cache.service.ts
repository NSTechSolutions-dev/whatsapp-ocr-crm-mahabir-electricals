import { redisConnection } from "../lib/redis";
import { findInventoryById } from "../repositories/inventory.repository";
import { logger } from "../utils/logger";

const CACHE_PREFIX = "inv:match:";
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const RATE_STALE_MS = 5 * 60 * 1000;

export interface CachedInventoryMatch {
  inventoryId: string;
  name: string;
  unit: string | null;
  rate: number | null;
  matchScore: number;
  matchType: "exact" | "alias" | "fuzzy" | "vector";
  cachedAt?: number;
}

export interface InventoryMatchFields {
  id: string;
  name: string;
  unit: string | null;
  currentRate: number | null;
}

function cacheKey(normalizedQuery: string): string {
  return `${CACHE_PREFIX}${normalizedQuery}`;
}

async function scanDelete(pattern: string): Promise<void> {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redisConnection.scan(cursor, "MATCH", pattern, "COUNT", 200);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redisConnection.del(...keys);
    }
  } while (cursor !== "0");
}

/** Redis cache for normalized query → inventory match (24h TTL). */
export async function getCachedMatch(normalizedQuery: string): Promise<CachedInventoryMatch | null> {
  const key = cacheKey(normalizedQuery);
  try {
    const raw = await redisConnection.get(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CachedInventoryMatch;
    if (!parsed.inventoryId || !parsed.name) return null;

    const age = Date.now() - (parsed.cachedAt ?? 0);
    if (age < RATE_STALE_MS) {
      logger.debug(`Cache hit for "${normalizedQuery}" → ${parsed.inventoryId}`);
      return parsed;
    }

    const inv = await findInventoryById(parsed.inventoryId);
    if (!inv) {
      await redisConnection.del(key);
      return null;
    }

    const fresh: CachedInventoryMatch = {
      ...parsed,
      name: inv.name,
      unit: inv.unit,
      rate: inv.currentRate,
      cachedAt: Date.now(),
    };
    await redisConnection.setex(key, CACHE_TTL_SECONDS, JSON.stringify(fresh));
    return fresh;
  } catch (error) {
    logger.warn(`Match cache read failed for "${normalizedQuery}": ${error}`);
    return null;
  }
}

export async function setCachedMatch(
  normalizedQuery: string,
  inventoryId: string,
  matchScore: number,
  matchType: CachedInventoryMatch["matchType"],
  inv?: InventoryMatchFields
): Promise<void> {
  const row = inv ?? (await findInventoryById(inventoryId));
  if (!row) return;

  const payload: CachedInventoryMatch = {
    inventoryId: row.id,
    name: row.name,
    unit: row.unit,
    rate: row.currentRate,
    matchScore,
    matchType,
    cachedAt: Date.now(),
  };

  try {
    await redisConnection.setex(cacheKey(normalizedQuery), CACHE_TTL_SECONDS, JSON.stringify(payload));
    logger.debug(`Cached match "${normalizedQuery}" → ${inventoryId} (score=${matchScore.toFixed(3)})`);
  } catch (error) {
    logger.warn(`Match cache write failed for "${normalizedQuery}": ${error}`);
  }
}

export async function invalidateMatchCacheOnly(): Promise<void> {
  try {
    await scanDelete(`${CACHE_PREFIX}*`);
    logger.info("Invalidated inventory match cache");
  } catch (error) {
    logger.warn(`Failed to invalidate match cache: ${error}`);
  }
}

/** Bust match + embedding query caches after bulk inventory CRUD. */
export async function invalidateAllMatchCache(): Promise<void> {
  try {
    await scanDelete(`${CACHE_PREFIX}*`);
    await scanDelete("emb:q:*");
    logger.info("Invalidated inventory match and embedding query cache");
  } catch (error) {
    logger.warn(`Failed to invalidate match cache: ${error}`);
  }
}
