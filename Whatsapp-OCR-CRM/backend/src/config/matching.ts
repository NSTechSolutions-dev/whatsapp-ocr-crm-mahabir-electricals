import { env } from "./env";

/** Minimum weighted score to accept inventory match without AI verification. */
export const MATCH_CONFIDENCE_THRESHOLD = 0.65;

/** Minimum cosine similarity for pgvector pre-match (0–1). */
export const EMBEDDING_MATCH_THRESHOLD = env.EMBEDDING_MATCH_THRESHOLD;

export function meetsConfidenceThreshold(score: number): boolean {
  return Math.round(score * 1000) / 1000 >= MATCH_CONFIDENCE_THRESHOLD;
}

export function meetsEmbeddingThreshold(similarity: number): boolean {
  return Math.round(similarity * 1000) / 1000 >= EMBEDDING_MATCH_THRESHOLD;
}
