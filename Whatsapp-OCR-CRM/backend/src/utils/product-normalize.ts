import { sanitizeProductName, titleCaseProduct } from "./product-parse";

/** Display-ready product name for inventory and enquiry rows. */
export function formatProductName(name: string): string {
  const cleaned = sanitizeProductName(name);
  if (!cleaned) return "";
  return titleCaseProduct(cleaned);
}

const UNIT_REPLACEMENTS: [RegExp, string][] = [
  [/\bkgs?\b/g, "kg"],
  [/\bkilograms?\b/g, "kg"],
  [/\bgrams?\b/g, "gm"],
  [/\bliters?\b/g, "litre"],
  [/\bltrs?\b/g, "litre"],
  [/\bl\b/g, "litre"],
  [/\bml\b/g, "ml"],
  [/\bpcs\b/g, "pc"],
  [/\bpieces?\b/g, "pc"],
  [/\bpe\b/g, "pc"],
  [/\bpes\b/g, "pc"],
  [/\bbandal\b/g, "bundle"],
  [/\bbndl\b/g, "bundle"],
  [/\bpkt\b/g, "packet"],
  [/\bpackets?\b/g, "packet"],
  [/\bbottles?\b/g, "bottle"],
  [/\bbox(es)?\b/g, "box"],
];

const PUNCTUATION_RE = /[.,\-_()\/\\]/g;

const GENERIC_ALIAS_TOKENS = new Set([
  "box",
  "gang",
  "holder",
  "switch",
  "socket",
  "pin",
  "light",
  "wire",
  "pvc",
  "mcb",
  "metre",
  "meter",
  "coil",
  "tape",
  "tap",
  "no",
  "nos",
  "way",
  "mm",
  "amp",
  "pcs",
  "pc",
  "put",
  "packet",
  "bundle",
  "the",
  "and",
]);

/** Strip bill rates, qty tails, and noise from a candidate alias string. */
export function sanitizeAlias(input: string): string | null {
  let text = (input || "").trim();
  if (!text) return null;

  text = text.replace(/=\s*\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s*\/-\s*$/i, "");
  text = text.replace(/\s+\d+(?:\.\d+)?\s*\/-\s*$/gi, "");
  text = text.replace(/\s*₹\s*[\d,]+(?:\.\d+)?\s*\/?-?\s*$/gi, "");
  text = text.replace(/\s+\d+(?:\.\d+)?\s*(?:NO|NOS|coil|coils|put|pcs?|pe?s?|m)\s*$/gi, "");
  text = text.replace(/\s*:-\s*/g, " ");
  text = text.replace(/\s*-\s*\d+a\s*$/i, "");
  text = text.replace(/\s+/g, " ").trim().toLowerCase();

  if (text.length < 2) return null;
  if (/^[\d,.\s₹/-]+$/.test(text)) return null;
  if (/^\d+\s*(?:mm|amp|a|way|no)$/i.test(text)) return null;

  return text;
}

function significantAliasTokens(text: string): string[] {
  return normalizeProductText(text)
    .split(/\s+/)
    .filter(
      (t) =>
        t.length > 1 &&
        !GENERIC_ALIAS_TOKENS.has(t) &&
        !/^\d/.test(t) &&
        !/^\d*a(mp)?$/.test(t) &&
        !/^\d+way$/.test(t) &&
        !/^\d+watt$/.test(t)
    );
}

function wireGaugeTokens(text: string): string[] {
  const normalized = text.replace(/(\d)\s+(\d)\s*mm/gi, "$1.$2mm");
  const matches = normalized.match(/\d+(?:\.\d+)?(?=\s*(?:mm|sq|sqr|$))/gi) || [];
  return matches.map((m) => parseFloat(m).toString());
}

/** Alias must relate to the product name — rejects shifted OCR lines from other products. */
export function isValidAliasForProduct(alias: string, productName: string): boolean {
  const a = sanitizeAlias(alias);
  const p = normalizeProductText(productName);
  if (!a || !p || a === p) return false;

  if (p.includes("wire") && a.includes("wire")) {
    const pG = wireGaugeTokens(p);
    const aG = wireGaugeTokens(a);
    if (pG.length > 0 && aG.length > 0 && !pG.some((g) => aG.includes(g))) {
      return false;
    }
  }

  const aTokens = significantAliasTokens(a);
  const pTokens = significantAliasTokens(p);
  if (pTokens.length === 0) {
    return p.includes(a) || a.includes(p);
  }

  const pSet = new Set(pTokens);
  const overlap = aTokens.filter((t) => pSet.has(t)).length;
  if (overlap >= 1) return true;
  if (p.includes(a) || a.includes(p)) return true;

  return false;
}

/** Clean alias list: strip prices, drop irrelevant OCR lines, dedupe. */
export function normalizeAliasList(productName: string, aliases: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const normName = normalizeProductText(productName);

  for (const raw of aliases || []) {
    const cleaned = sanitizeAlias(raw);
    if (!cleaned || cleaned === normName) continue;
    if (!isValidAliasForProduct(cleaned, productName)) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }

  return out;
}

/** Build aliases from OCR raw text — returns [] if raw is another product line. */
export function deriveAliasesFromRaw(productName: string, rawText?: string | null): string[] {
  if (!rawText?.trim()) return [];
  const cleaned = sanitizeAlias(rawText);
  if (!cleaned || !isValidAliasForProduct(cleaned, productName)) return [];
  if (normalizeProductText(cleaned) === normalizeProductText(productName)) return [];
  return [cleaned];
}

/** Normalize enquiry/product text for inventory search and cache keys. */
export function normalizeProductText(input: string): string {
  let text = (input || "").toLowerCase().trim();
  text = text.replace(PUNCTUATION_RE, " ");
  for (const [pattern, replacement] of UNIT_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s+/g, " ").trim();
}

/** Build denormalized search_text for an inventory row. */
export function buildInventorySearchText(
  name: string,
  aliases: string[] | null | undefined,
  unit: string | null | undefined
): string {
  const parts: string[] = [name];
  if (unit) parts.push(unit);
  if (aliases?.length) parts.push(...aliases);
  return normalizeProductText(parts.join(" "));
}
