import { logger } from "./logger";

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "for", "with", "of", "to", "in", "on", "at",
  "by", "from", "please", "send", "need", "want", "require", "get", "buy", "order",
  "deliver", "me", "us", "you", "urgent", "urgently", "fast",
]);

const LEMMA_MAP: Record<string, string> = {
  boxes: "box",
  pkts: "packet",
  packets: "packet",
  pieces: "piece",
  bottles: "bottle",
  btls: "bottle",
  btl: "bottle",
  dozens: "dozen",
  dz: "dozen",
  doz: "dozen",
  rolls: "roll",
  sheets: "sheet",
  reams: "ream",
  rms: "ream",
  cartons: "carton",
  bandal: "bundle",
  bndl: "bundle",
  bundles: "bundle",
  pes: "pcs",
  papers: "paper",
  copiers: "copier",
  pens: "pen",
  pencils: "pencil",
  markers: "marker",
  staplers: "stapler",
  pins: "pin",
  clips: "clip",
  binders: "binder",
  files: "file",
  folders: "folder",
  notebooks: "notebook",
  books: "book",
  calculators: "calculator",
  scissors: "scissor",
  tapes: "tape",
  rubbers: "rubber",
  erasers: "eraser",
  sharpeners: "sharpener",
  scales: "scale",
  rulers: "ruler",
  highlighters: "highlighter",
  envelopes: "envelope",
  diaries: "diary",
  cards: "card",
  boards: "board",
  dusters: "duster",
  inks: "ink",
  glues: "glue",
  pads: "pad",
  coler: "colour",
  colear: "colour",
  colur: "colour",
  havells: "havell",
};

export function preprocessText(text: string): string {
  if (!text) return "";

  let normalized = text.toLowerCase();
  normalized = normalized.replace(/(\d)\.(\d+)/g, "$1§$2");
  normalized = normalized.replace(/[^\w\s#§\-x]/g, " ");
  normalized = normalized.replace(/§/g, ".");

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const processedTokens = tokens
    .filter((token) => !STOP_WORDS.has(token))
    .map((token) => {
      if (LEMMA_MAP[token]) return LEMMA_MAP[token];
      if (token.endsWith("ies") && token.length > 5) return token.slice(0, -3) + "y";
      if (
        token.endsWith("es") &&
        (token.endsWith("shes") || token.endsWith("ches") || token.endsWith("xes") || token.endsWith("ses")) &&
        token.length > 4
      ) {
        return token.slice(0, -2);
      }
      if (
        token.endsWith("s") &&
        !token.endsWith("ss") &&
        !token.endsWith("us") &&
        !token.endsWith("is") &&
        !token.endsWith("as") &&
        token.length > 2 &&
        token !== "pcs"
      ) {
        return token.slice(0, -1);
      }
      return token;
    });

  const cleanedText = processedTokens.join(" ").trim();
  logger.debug(`NLP Preprocess: "${text}" → "${cleanedText}"`);
  return cleanedText;
}
