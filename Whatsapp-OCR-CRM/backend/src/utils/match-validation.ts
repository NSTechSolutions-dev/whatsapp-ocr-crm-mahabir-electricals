import { normalizeProductText } from "./product-normalize";
import { isDimensionContinuation, PRODUCT_NOUN_REGEX } from "./order-line-prepare";

const PRODUCT_TYPE_TOKENS = [
  "tape",
  "tap",
  "pen",
  "paper",
  "salt",
  "wire",
  "pipe",
  "stapler",
  "pin",
  "folder",
  "notebook",
  "marker",
  "glue",
  "oil",
  "detergent",
  "pvc",
  "box",
  "switch",
  "socket",
  "holder",
  "mcb",
  "coil",
  "light",
  "gutka",
  "medal",
];

const GENERIC_TOKENS = new Set([
  "mm",
  "cm",
  "pc",
  "pcs",
  "piece",
  "bundle",
  "box",
  "kg",
  "no",
  "alag",
  "colour",
  "color",
  "separate",
  "different",
]);

function significantTokens(text: string): string[] {
  return normalizeProductText(text)
    .split(/\s+/)
    .filter((t) => t.length > 1 && !GENERIC_TOKENS.has(t) && !/^\d+$/.test(t));
}

export function tokenOverlapScore(query: string, candidate: string): number {
  const qTokens = significantTokens(query);
  if (qTokens.length === 0) return 0;
  const cSet = new Set(significantTokens(candidate));
  const overlap = qTokens.filter((t) => cSet.has(t)).length;
  return overlap / qTokens.length;
}

export function hasProductNoun(text: string): boolean {
  return PRODUCT_NOUN_REGEX.test(text);
}

/** Reject matches where query names a product type absent from the candidate (e.g. tape → pen). */
export function shouldRejectMatch(query: string, candidateName: string, score: number): boolean {
  const qNorm = normalizeProductText(query);
  const cNorm = normalizeProductText(candidateName);

  for (const noun of PRODUCT_TYPE_TOKENS) {
    if (qNorm.includes(noun) && !cNorm.includes(noun)) {
      return true;
    }
  }

  if (isDimensionContinuation(query) && !hasProductNoun(candidateName)) {
    return true;
  }

  const overlap = tokenOverlapScore(query, candidateName);
  if (overlap < 0.34 && score < 0.92) {
    return true;
  }

  // Single-token partial hits (e.g. "black" only) with different product types
  const qTokens = significantTokens(query);
  const cTokens = significantTokens(candidateName);
  if (qTokens.length >= 2 && overlap === 1 / qTokens.length && score < 0.9) {
    return true;
  }

  if (cTokens.length > 0 && qTokens.length > 0 && overlap === 0) {
    return true;
  }

  return false;
}
