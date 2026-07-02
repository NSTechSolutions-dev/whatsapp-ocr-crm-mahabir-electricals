/** Strip leading request/filler words from enquiry lines */
const FILLER_PREFIX =
  /^(?:need|want|please(?:\s+send|\s+order)?|send|order|get|give|require|looking\s+for|i\s+need|pls|kindly)\s+/i;

const QTY_UNIT_REGEX =
  /(?:^|\b)(\d+(?:\.\d+)?)\s*(ream|reams|box|boxes|pcs|pc|pkt|pkts|packet|packets|no|nos|unit|units|kg|g|dozen|dzn|rim|rims|bandal|bndl|bundle|bundles|pes|pe|put|coil|coils|metre|meter|m|roll|rolls|way|amp)?\b/i;

/** Strip trailing Indian bill rate suffix e.g. "160/-", "= 13 13/-". */
export function stripTrailingRate(line: string): { text: string; rate: number | null; qty?: number | null } {
  let text = line.trim();
  let rate: number | null = null;

  const eqRate = text.match(/=\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*\/-\s*$/i);
  if (eqRate) {
    rate = parseFloat(eqRate[2]) || null;
    text = text.slice(0, eqRate.index).trim();
    return { text, rate, qty: parseFloat(eqRate[1]) || null };
  }

  const slashRate = text.match(/\s+(\d+(?:\.\d+)?)\s*\/-\s*$/);
  if (slashRate) {
    rate = parseFloat(slashRate[1]) || null;
    text = text.slice(0, slashRate.index).trim();
  }

  return { text, rate };
}

/** Normalize whitespace and remove leading filler verbs from a product name */
export function sanitizeProductName(name: string): string {
  let s = name.trim().replace(/\s+/g, " ");
  while (FILLER_PREFIX.test(s)) {
    s = s.replace(FILLER_PREFIX, "").trim();
  }
  return s;
}

const BRAND_DISPLAY: Record<string, string> = {
  havells: "Havells",
  havell: "Havells",
  aftak: "Aftak",
  anchor: "Anchor",
  polycab: "Polycab",
  finolex: "Finolex",
  kissk: "Kissk",
  gold: "Gold",
  medal: "Medal",
};

const UPPERCASE_TOKENS = new Set(["pvc", "mcb"]);

/** Title-case words but preserve size/model tokens like A4, 2.5 mm, 6A, PVC */
export function titleCaseProduct(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const result: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const lower = word.toLowerCase();
    const next = words[i + 1]?.toLowerCase();

    if (/^a[0-5]$/i.test(word)) {
      result.push(word.toUpperCase());
      continue;
    }
    if (/^no\.?\s*\d+$/i.test(word)) {
      result.push(word.replace(/^no\.?\s*/i, "No. "));
      continue;
    }
    if (/^#\d+$/.test(word)) {
      result.push(word);
      continue;
    }
    if (/^\d+(?:\.\d+)?$/.test(word) && next === "mm") {
      result.push(word);
      continue;
    }
    if (lower === "mm") {
      result.push("mm");
      continue;
    }
    if (/^\d+(?:\.\d+)?mm$/i.test(word)) {
      result.push(word.replace(/mm$/i, " mm"));
      continue;
    }
    if (/^\d+a(mp)?$/i.test(word)) {
      result.push(word.toUpperCase());
      continue;
    }
    if (/^\d+way$/i.test(word)) {
      const n = word.match(/^(\d+)way$/i)?.[1];
      result.push(n ? `${n}-Way` : word);
      continue;
    }
    if (UPPERCASE_TOKENS.has(lower)) {
      result.push(word.toUpperCase());
      continue;
    }
    if (BRAND_DISPLAY[lower]) {
      result.push(BRAND_DISPLAY[lower]);
      continue;
    }
    if (/^\d+$/.test(word)) {
      result.push(word);
      continue;
    }
    if (lower === "sq" && next === "mm") {
      result.push("Sq");
      continue;
    }

    result.push(word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  }

  return result.join(" ");
}

export interface ParsedOrderLine {
  product: string;
  qty: number;
  unit: string | null;
  raw: string;
  rate: number | null;
}

/** Parse Indian electrical bill lines: "PRODUCT ... QTY UNIT RATE/-" */
export function parseElectricalOrderLine(line: string): ParsedOrderLine | null {
  const raw = line.trim();
  if (raw.length < 2) return null;

  const { text: withoutRate, rate, qty: rateQty } = stripTrailingRate(raw);
  let working = sanitizeProductName(withoutRate);

  // Protect "5 PIN Socket" — leading number is part of product name
  working = working.replace(/\b(\d+)\s+PIN\b/gi, "§$1§PIN");

  // Parse qty+unit from end: "... 2 coil", "... 5 NO", "... 3S NO"
  const tailMatch =
    working.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*(NO|NOS|coil|coils|put|pcs|pc|pe|pes|way|AMP|A|M)\s*$/i) ||
    working.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*S?\s*NO\s*$/i) ||
    working.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*$/i);

  let product = working;
  let qty = 1;
  let unit: string | null = null;

  if (tailMatch) {
    product = tailMatch[1].trim();
    qty = rateQty && rateQty > 0 ? rateQty : parseFloat(tailMatch[2]) || 1;
    const u = (tailMatch[3] || "").toLowerCase();
    if (u === "no" || u === "nos" || u === "pc" || u === "pcs" || u === "pe" || u === "pes") unit = "Pcs";
    else if (u === "put") unit = "Packet";
    else if (u.startsWith("coil")) unit = "Coil";
    else if (u === "m") unit = "Metre";
    else if (u === "way") unit = "Pcs";
    else if (u === "amp" || u === "a") unit = "Pcs";
  } else if (rate !== null) {
    product = working.replace(/\s*=\s*\d+\s*$/, "").trim();
    product = sanitizeProductName(product);
    if (!product || product.length < 2) return null;
    return {
      product: titleCaseProduct(product),
      qty: 1,
      unit: product.toLowerCase().includes("wire") ? "Coil" : "Pcs",
      raw,
      rate,
    };
  } else {
    return null;
  }

  product = product.replace(/§(\d+)§PIN/gi, "$1 PIN");
  product = sanitizeProductName(product);

  // Normalize wire lines: "(Havell) 2.5 -" -> "havells wire 2.5 mm"
  const wireMatch = product.match(/\(?\s*(havell?s?|gold\s*medal)\s*\)?\s*([\d.]+)\s*(?:mm|sq)?/i);
  if (wireMatch) {
    const gauge = wireMatch[2];
    product = `${wireMatch[1]} wire ${gauge} mm`;
  } else if (/^[\d.]+\s*(?:coil|sq)/i.test(product) || /^\.?\d+\s*sqr/i.test(product)) {
    const gauge = product.match(/([\d.]+)/)?.[1];
    if (gauge) product = `havells wire ${gauge} mm`;
  } else if (/^[\d.]+\s*coil$/i.test(product.trim())) {
    const gauge = product.match(/^([\d.]+)/)?.[1];
    if (gauge) product = `havells wire ${gauge} mm`;
  }

  product = titleCaseProduct(product);

  if (!product || product.length < 2) return null;

  if (!unit) {
    const lower = product.toLowerCase();
    if (lower.includes("wire") || lower.includes("coil")) unit = "Coil";
    else if (lower.includes("tape") || lower.includes("tap")) unit = "Metre";
    else unit = "Pcs";
  }

  return { product, qty, unit, raw, rate };
}

/** Parse a single order line into product, qty, and unit */
export function parseOrderLine(line: string): ParsedOrderLine | null {
  const raw = line.trim();
  if (raw.length < 2) return null;

  let working = sanitizeProductName(raw);
  const stripped = stripTrailingRate(working);
  working = stripped.text;
  const extractedRate = stripped.rate;

  const match = working.match(QTY_UNIT_REGEX);
  let qty = 1;
  let unit: string | null = null;
  let product = working;

  if (match && match.index !== undefined) {
    qty = parseFloat(match[1]) || 1;
    const u = (match[2] || "").toLowerCase();
    if (u.startsWith("ream")) unit = "Ream";
    else if (u.startsWith("box")) unit = "Box";
    else if (u.startsWith("pkt") || u.startsWith("packet")) unit = "Pkt";
    else if (u === "pc" || u === "pcs" || u === "pe" || u === "pes" || u === "put" || u.startsWith("no")) unit = "Pcs";
    else if (u.startsWith("bandal") || u.startsWith("bndl") || u.startsWith("bundle")) unit = "Bundle";
    else if (u.startsWith("coil")) unit = "Coil";
    else if (u.startsWith("metre") || u.startsWith("meter") || u === "m") unit = "Metre";
    else if (u.startsWith("roll")) unit = "Roll";
    else if (u === "kg" || u === "g") unit = u.toUpperCase();
    else if (u) unit = match[2]!.charAt(0).toUpperCase() + match[2]!.slice(1).toLowerCase();
    product = (working.slice(0, match.index) + working.slice(match.index + match[0].length)).trim();
  }

  product = sanitizeProductName(product);
  product = titleCaseProduct(product);

  if (!product || product.length < 2) return null;

  // Infer unit from product when missing
  if (!unit) {
    const lower = product.toLowerCase();
    if (lower.includes("paper")) unit = "Ream";
    else if (lower.includes("pin")) unit = "Box";
    else if (lower.includes("wire") || lower.includes("cable") || lower.includes("coil")) unit = "Coil";
    else if (/\d+\s*m\b/i.test(raw) || lower.includes("tape") || lower.includes("tap")) unit = "Metre";
    else unit = "Pcs";
  }

  return { product, qty, unit, raw, rate: extractedRate };
}

/** Apply sanitization to LLM/OCR extracted product names */
export function normalizeExtractedProduct(
  product: string,
  raw?: string,
  qty?: number,
  unit?: string | null
): { product: string; qty: number; unit: string | null } {
  const reparsed = raw ? parseOrderLine(raw) : null;
  if (reparsed && reparsed.product.length >= 2) {
    return {
      product: reparsed.product,
      qty: qty && qty > 0 ? qty : reparsed.qty,
      unit: unit || reparsed.unit,
    };
  }

  let cleaned = sanitizeProductName(product);
  cleaned = titleCaseProduct(cleaned);
  return {
    product: cleaned,
    qty: qty && qty > 0 ? qty : 1,
    unit: unit || null,
  };
}

/** Match and replace ditto symbols with previous product names */
export function resolveDittoSymbols(rawLines: string[]): string[] {
  let previousProduct = "";
  const resolvedLines: string[] = [];
  
  // Pattern to match ditto sequences at start of the line: e.g. " " ", "", ,, do, ditto
  const dittoStartRegex = /^(?:[\"\'\,\/\|]+(?:\s+[\"\'\,\/\|]+)*|do|ditto)\b/i;
  // Pattern to match general isolated ditto mark anywhere
  const dittoGeneralRegex = /(?:^|\s)(?:\"\"|\"|\'\'|\|\||\/\/|\,\,|do|ditto)(?:\s|$)/i;

  for (const line of rawLines) {
    let resolvedLine = line.trim();
    if (!resolvedLine) continue;

    if (previousProduct) {
      if (dittoStartRegex.test(resolvedLine)) {
        resolvedLine = resolvedLine.replace(dittoStartRegex, previousProduct).trim();
      } else if (dittoGeneralRegex.test(resolvedLine)) {
        // Replace isolated ditto marks in the line
        const globalDitto = new RegExp(dittoGeneralRegex.source, "gi");
        resolvedLine = resolvedLine.replace(globalDitto, ` ${previousProduct} `).replace(/\s+/g, " ").trim();
      }
    }

    // Capture the product name for the next lines if this line is a standard product line
    if (!dittoStartRegex.test(resolvedLine) && !dittoGeneralRegex.test(resolvedLine)) {
      const parsed = parseOrderLine(resolvedLine);
      if (parsed && parsed.product) {
        previousProduct = parsed.product;
      }
    }
    
    resolvedLines.push(resolvedLine);
  }

  return resolvedLines;
}
