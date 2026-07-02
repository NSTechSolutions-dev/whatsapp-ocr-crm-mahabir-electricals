import {
  findExactInventoryMatch,
  searchTopCandidates,
  InventorySearchRow,
} from "../repositories/inventory.repository";
import { normalizeProductText } from "../utils/product-normalize";

export type { InventorySearchRow };

/** Stage 2 & 3: exact match (case-insensitive) then trigram search with weighted scoring. */
export async function searchInventory(
  query: string,
  unitHint: string | null = null,
  limit: number = 10
): Promise<InventorySearchRow[]> {
  const normalized = normalizeProductText(query);
  if (!normalized) return [];

  const exact = await findExactInventoryMatch(normalized);
  const trigram = await searchTopCandidates(normalized, unitHint, limit);

  if (exact) {
    const rest = trigram.filter((row) => row.id !== exact.id);
    return [exact, ...rest].slice(0, limit);
  }

  return trigram;
}
