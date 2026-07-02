import { parseOrderLine, parseElectricalOrderLine, resolveDittoSymbols } from "./product-parse";

const INDEX_PREFIX_REGEX = /^(?:\(\s*\d+\s*\)\s*|[①②③④⑤⑥⑦⑧⑨⑩]\s*)/;
const METADATA_LINE_REGEX =
  /^(?:location|address|landmark|mob|mobile|phone|gstin|gst|date|total|subtotal|quotation|bill|name|to|bill to|original|ocr)\b/i;
const PHONE_REGEX = /^\+?\d[\d\s-]{8,14}\d$/;

const ATTRIBUTE_ONLY_REGEX =
  /^(?:alag\s+alag|same|different|separate|misc)?\s*(?:colou?rs?|colour|coler|colear|colur|shade)s?$/i;

export const PRODUCT_NOUN_REGEX =
  /\b(wire|wires|pipe|pipes|tape|tapes|taps?|pen|pens|paper|salt|oil|stapler|pins?|folder|notebook|marker|glue|detergent|pvc|box|boxes|gang|switch|switches|socket|sockets|holder|holders|bulb|bulbs|cable|cables|coil|coils|mcb|light|lights|gutka|gutkha|metre|meter|medal|angle|bit|combine|aftak|warm|sub|gutka)\b/i;

const BRAND_REGEX =
  /\b(havell?s?|gold\s*medal|polycab|finolex|anchor|gm|syska|tata|fortune|surf|cello|camlin|kissk?)\b/i;

const DIMENSION_LINE_REGEX =
  /^[\d.]+\s*(?:mm|cm|sq\s*m\.?\s*m\.?|sqr\s*m\.?\s*m\.?)?(?:\s+[\d.]+\s*(?:bandal|bundle|bndl|coil|pcs?|pe?s?|nos?|put))?$/i;

/** Lines that are only amounts, totals, or dates — common in two-column bills. */
const AMOUNT_ONLY_REGEX =
  /^\s*(?:₹\s*)?[\d,]+(?:\.\d+)?\s*\/?-?\s*$/;

const DATE_LINE_REGEX = /^\d{1,2}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*\d{2,4}$/;

const DASH_ONLY_REGEX = /^[-–—\s]+$/;

function isAmountOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || DASH_ONLY_REGEX.test(trimmed)) return true;
  if (AMOUNT_ONLY_REGEX.test(trimmed)) return true;
  if (DATE_LINE_REGEX.test(trimmed.replace(/\s+/g, ""))) return true;
  // Pure number columns from right side of two-column OCR (e.g. "98000", "74536")
  if (/^[\d,]+$/.test(trimmed) && trimmed.replace(/,/g, "").length >= 3) return true;
  return false;
}

function isIncompleteLine(line: string): boolean {
  const t = line.trim();
  return t.length <= 3 || /^(pvc|pvc\s*-)\s*$/i.test(t);
}

function stripMetadataLines(lines: string[]): string[] {
  return lines
    .map((line) => line.replace(INDEX_PREFIX_REGEX, "").trim())
    .filter((line) => {
      if (!line || line.length < 2) return false;
      if (METADATA_LINE_REGEX.test(line)) return false;
      if (PHONE_REGEX.test(line.replace(/\s+/g, ""))) return false;
      if (isAmountOnlyLine(line)) return false;
      if (isIncompleteLine(line)) return false;
      const lower = line.toLowerCase();
      if (
        lower.includes("mandir") ||
        lower.includes("temple") ||
        lower.includes("near") ||
        lower.includes("opposite") ||
        lower.includes("radha krishna")
      ) {
        return false;
      }
      return true;
    });
}

function normalizeElectricalLine(line: string): string {
  let text = line.trim();
  text = text.replace(/\s*:-\s*/g, " ");
  text = text.replace(/\s+/g, " ");
  return text;
}

function extractProductContext(line: string): string {
  const lower = line.toLowerCase();
  if (/\b(havell?s?|gold\s*medal)\b/i.test(line) || /\b\d+\.?\d*\s*(?:mm|sq)/i.test(line)) {
    const brand = lower.match(BRAND_REGEX)?.[0] || (lower.includes("gold") ? "gold medal" : "havells");
    if (/\bwire\b/i.test(line) || /\bcoil\b/i.test(line) || /\d+\.?\d*\s*mm/i.test(line)) {
      return `${brand} wire`;
    }
  }
  const brand = lower.match(BRAND_REGEX)?.[0] || "";
  const noun = lower.match(PRODUCT_NOUN_REGEX)?.[0] || "";
  if (brand && noun) return `${brand} ${noun}`.trim();
  if (noun) return noun;
  if (brand) return brand;
  return "";
}

function isAttributeOnlyLine(line: string): boolean {
  return ATTRIBUTE_ONLY_REGEX.test(line.trim());
}

function isDimensionContinuation(line: string): boolean {
  const trimmed = line.trim();
  if (PRODUCT_NOUN_REGEX.test(trimmed) || BRAND_REGEX.test(trimmed)) return false;
  return (
    DIMENSION_LINE_REGEX.test(trimmed) ||
    /^[\d.]+\s*(?:mm|sq)/i.test(trimmed) ||
    /^\(?\s*havell/i.test(trimmed)
  );
}

/** Merge brand header lines like "Gold medal" + "wire (H)". */
function mergeHeaderFragments(lines: string[]): string[] {
  const merged: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    if (
      next &&
      !/\d/.test(line) &&
      line.split(/\s+/).length <= 3 &&
      next.split(/\s+/).length <= 4 &&
      PRODUCT_NOUN_REGEX.test(next)
    ) {
      merged.push(`${line} ${next}`.replace(/\s+/g, " ").trim());
      i++;
      continue;
    }
    merged.push(line);
  }
  return merged;
}

/** Merge colour/attribute continuations and inherit product context for bare dimension lines. */
export function mergeContinuationLines(lines: string[]): string[] {
  const merged: string[] = [];
  let lastContext = "";

  for (const rawLine of lines) {
    const line = normalizeElectricalLine(rawLine);
    if (!line) continue;

    if (isAttributeOnlyLine(line)) {
      if (merged.length > 0) {
        merged[merged.length - 1] = `${merged[merged.length - 1]} ${line}`;
      }
      continue;
    }

    if (isDimensionContinuation(line) && lastContext && /wire/i.test(lastContext)) {
      merged.push(`${lastContext} ${line}`.replace(/\s+/g, " ").trim());
      continue;
    }

    merged.push(line);
    const context = extractProductContext(line);
    if (context) {
      lastContext = context;
    }
  }

  return merged;
}

/** Split OCR text, drop metadata/amounts, resolve ditto marks, merge continuations. */
export function prepareOcrLines(rawOcrText: string): string[] {
  const splitRawLines = rawOcrText
    .split(/(?:[\n\r]+)/)
    .map((l) => l.trim().replace(/\.+$/, ""))
    .filter((l) => l.length > 0);

  const cleaned = stripMetadataLines(splitRawLines);
  const withHeaders = mergeHeaderFragments(cleaned);
  const dittoResolved = resolveDittoSymbols(withHeaders);
  return mergeContinuationLines(dittoResolved);
}

export function prepareOcrText(rawOcrText: string): string {
  return prepareOcrLines(rawOcrText).join("\n");
}

export { isAttributeOnlyLine, isDimensionContinuation, isAmountOnlyLine };
