import axios from "axios";
import crypto from "crypto";
import { env } from "../config/env";
import { redisConnection } from "../lib/redis";
import { GeminiApiError, withGeminiBackoff } from "../lib/gemini-retry";
import { logger } from "../utils/logger";

const EMBEDDING_DIMENSION = env.EMBEDDING_DIMENSION;
const QUERY_CACHE_PREFIX = "emb:q:";
const QUERY_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const inFlightEmbeds = new Map<string, Promise<number[] | null>>();

export let embeddingDbReady = false;

export function setEmbeddingDbReady(ready: boolean) {
  embeddingDbReady = ready;
}

function isMockMode(): boolean {
  return !env.GEMINI_API_KEY || env.GEMINI_API_KEY.includes("placeholder");
}

function requireGeminiKey(): string {
  if (isMockMode()) {
    throw new GeminiApiError("GEMINI_API_KEY is not configured", undefined, false);
  }
  return env.GEMINI_API_KEY!;
}

function queryCacheKey(text: string): string {
  const hash = crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex");
  return `${QUERY_CACHE_PREFIX}${hash}`;
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.map((v) => Number(v).toFixed(8)).join(",")}]`;
}

function embedRequestBody(text: string) {
  return {
    model: `models/${env.EMBEDDING_MODEL}`,
    content: {
      parts: [{ text }],
    },
    outputDimensionality: EMBEDDING_DIMENSION,
    taskType: "SEMANTIC_SIMILARITY",
  };
}

async function callGeminiEmbed(text: string): Promise<number[]> {
  const apiKey = requireGeminiKey();

  const response = await withGeminiBackoff(
    () =>
      axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${env.EMBEDDING_MODEL}:embedContent?key=${apiKey}`,
        embedRequestBody(text),
        {
          headers: { "Content-Type": "application/json" },
          timeout: 30000,
        }
      ),
    "Gemini embed"
  );

  const values: number[] | undefined = response.data?.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Invalid embedding response: expected ${EMBEDDING_DIMENSION} dims, got ${values?.length ?? 0}`
    );
  }
  return values.map(Number);
}

async function callGeminiEmbedBatch(texts: string[]): Promise<number[][]> {
  const apiKey = requireGeminiKey();

  const response = await withGeminiBackoff(
    () =>
      axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${env.EMBEDDING_MODEL}:batchEmbedContents?key=${apiKey}`,
        {
          requests: texts.map((text) => embedRequestBody(text)),
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 60000,
        }
      ),
    "Gemini batch embed"
  );

  const embeddings: any[] = response.data?.embeddings || [];
  if (embeddings.length !== texts.length) {
    throw new Error(`Batch embed size mismatch: ${embeddings.length} vs ${texts.length}`);
  }

  return embeddings.map((item, index) => {
    const values: number[] | undefined = item?.values;
    if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSION) {
      throw new Error(`Invalid batch embedding at index ${index}`);
    }
    return values.map(Number);
  });
}

/** Single text → Gemini embedding (768-dim via outputDimensionality). */
export async function embedText(text: string): Promise<number[] | null> {
  const cleanText = (text || "").trim();
  if (!cleanText || !env.EMBEDDING_ENABLED || !embeddingDbReady) {
    return null;
  }

  if (isMockMode()) {
    return null;
  }

  return callGeminiEmbed(cleanText);
}

/** Batch embed — one API call for multiple texts. */
export async function embedTexts(texts: string[]): Promise<(number[] | null)[]> {
  const clean = texts.map((t) => (t || "").trim()).filter(Boolean);
  if (clean.length === 0 || !env.EMBEDDING_ENABLED || !embeddingDbReady) {
    return texts.map(() => null);
  }

  if (isMockMode()) {
    return texts.map(() => null);
  }

  const batchSize = 10;
  const results: (number[] | null)[] = [];
  for (let i = 0; i < clean.length; i += batchSize) {
    const chunk = clean.slice(i, i + batchSize);
    const vectors = await callGeminiEmbedBatch(chunk);
    results.push(...vectors);
    if (i + batchSize < clean.length) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return results;
}

export async function embedTextsKeyed(
  texts: string[]
): Promise<{ vectors: Map<string, number[]>; apiCalls: number }> {
  const unique = Array.from(new Set(texts.map((t) => (t || "").trim()).filter(Boolean)));
  const vectors = new Map<string, number[]>();
  if (unique.length === 0 || !env.EMBEDDING_ENABLED || !embeddingDbReady || isMockMode()) {
    return { vectors, apiCalls: 0 };
  }

  const uncached: string[] = [];
  let apiCalls = 0;

  for (const name of unique) {
    try {
      const { vector, cacheHit } = await embedQueryCached(name);
      if (vector) {
        vectors.set(name, vector);
        if (!cacheHit) apiCalls++;
      } else {
        uncached.push(name);
      }
    } catch {
      uncached.push(name);
    }
  }

  if (uncached.length > 0) {
    const batchSize = 10;
    for (let i = 0; i < uncached.length; i += batchSize) {
      const chunk = uncached.slice(i, i + batchSize);
      const results = await embedTexts(chunk);
      apiCalls++;
      for (let j = 0; j < chunk.length; j++) {
        const vector = results[j];
        if (vector) vectors.set(chunk[j], vector);
      }
    }
  }

  return { vectors, apiCalls };
}

/** Cached query embedding (Redis, 7-day TTL). */
export async function embedQueryCached(
  text: string
): Promise<{ vector: number[] | null; cacheHit: boolean }> {
  const cleanText = (text || "").trim();
  if (!cleanText) return { vector: null, cacheHit: false };

  const key = queryCacheKey(cleanText);
  try {
    const cached = await redisConnection.get(key);
    if (cached) {
      const parsed = JSON.parse(cached) as number[];
      if (Array.isArray(parsed) && parsed.length === EMBEDDING_DIMENSION) {
        return { vector: parsed, cacheHit: true };
      }
    }
  } catch (error) {
    logger.warn(`Embedding cache read failed: ${error}`);
  }

  let pending = inFlightEmbeds.get(key);
  if (!pending) {
    pending = embedText(cleanText)
      .then(async (vector) => {
        if (vector) {
          try {
            await redisConnection.setex(key, QUERY_CACHE_TTL_SECONDS, JSON.stringify(vector));
          } catch (error) {
            logger.warn(`Embedding cache write failed: ${error}`);
          }
        }
        return vector;
      })
      .catch((error: any) => {
        logger.warn(`Embedding failed for "${cleanText}": ${error?.message || error}`);
        return null;
      })
      .finally(() => {
        inFlightEmbeds.delete(key);
      });
    inFlightEmbeds.set(key, pending);
  }

  const vector = await pending;
  return { vector, cacheHit: false };
}

export function toVectorLiteral(vector: number[]): string {
  return vectorLiteral(vector);
}

export { EMBEDDING_DIMENSION };
