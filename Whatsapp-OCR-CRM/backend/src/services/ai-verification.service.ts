import { getStructuredData } from "../lib/claude";
import { logger } from "../utils/logger";
import { InventorySearchRow } from "../repositories/inventory.repository";
import { meetsConfidenceThreshold } from "../config/matching";

const VERIFICATION_PROMPT = `You are an inventory matching assistant for Mahabir Electricals, an Indian wholesale electrical supplies CRM.

Given a customer's product text and a numbered list of inventory candidates, pick the single best match ONLY if it is the same product type.

Rules:
- The candidate must match the product category (wire→wire, tape→tape, pen→pen, pipe→pipe, salt→salt). Never match by colour or partial word alone.
- "black tape" must NOT match "black ball pen". "1 mm wire" must NOT match "tata salt 1kg".
- If no candidate is a genuine match, return {"id":""}.
- Handle spelling and OCR mistakes only when the product type clearly matches.
- Return ONLY a JSON object with the chosen inventory id. No markdown, no explanation.

Format: {"id":"<inventory-id>"} or {"id":""} if none match`;

function formatCandidates(candidates: InventorySearchRow[]): string {
  return candidates
    .slice(0, 10)
    .map((c, i) => `${i + 1} ${c.name}${c.unit ? ` (${c.unit})` : ""} [id:${c.id}]`)
    .join("\n");
}

/** Stage 4: AI verification with at most 10 candidates — never full inventory. */
export async function verifyInventoryMatch(
  customerText: string,
  candidates: InventorySearchRow[]
): Promise<string | null> {
  if (candidates.length === 0) return null;

  const trimmed = candidates.slice(0, 10);

  // High-confidence single candidate — no AI needed
  if (trimmed.length === 1 && meetsConfidenceThreshold(trimmed[0].score)) {
    return trimmed[0].id;
  }

  try {
    const rawResult = await getStructuredData(
      VERIFICATION_PROMPT,
      `Customer text:\n${customerText}\n\nCandidates:\n${formatCandidates(trimmed)}\n\nReturn JSON object only.`
    );

    let cleaned = rawResult.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(json)?\n?/i, "").replace(/\n?```$/, "");
    }
    cleaned = cleaned.trim();

    const data = JSON.parse(cleaned);
    const chosenId = String(data.id || "").trim();
    if (!chosenId) {
      logger.info(`AI verification rejected all candidates for "${customerText}"`);
      return null;
    }
    if (chosenId && trimmed.some((c) => c.id === chosenId)) {
      logger.info(`AI verification selected inventory ${chosenId} for "${customerText}"`);
      return chosenId;
    }

    logger.warn(`AI verification returned invalid id for "${customerText}"`);
    return null;
  } catch (error) {
    logger.warn(`AI verification failed for "${customerText}": ${error}`);
    return null;
  }
}
