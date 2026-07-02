import { logger } from "../utils/logger";

export class GeminiApiError extends Error {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, status?: number, retryable = true) {
    super(message);
    this.name = "GeminiApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

export function isRetryableGeminiStatus(status?: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isRetryableNetworkError(error: any): boolean {
  const code = error?.code;
  return code === "ECONNABORTED" || code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ENOTFOUND";
}

export function toGeminiApiError(error: any, label: string): GeminiApiError {
  if (error instanceof GeminiApiError) return error;

  const status = error?.response?.status as number | undefined;
  const apiMessage =
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.message ||
    `${label} failed`;

  const retryable = isRetryableGeminiStatus(status) || isRetryableNetworkError(error);
  return new GeminiApiError(apiMessage, status, retryable);
}

export interface GeminiBackoffOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Exponential backoff for Gemini / Vertex-style rate limits (2s → 4s → 8s → …).
 */
export async function withGeminiBackoff<T>(
  fn: () => Promise<T>,
  label: string,
  options: GeminiBackoffOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 2000;
  const maxDelayMs = options.maxDelayMs ?? 32000;

  let lastError: GeminiApiError | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const geminiError = toGeminiApiError(error, label);
      lastError = geminiError;

      const isLastAttempt = attempt >= maxAttempts - 1;
      if (!geminiError.retryable || isLastAttempt) {
        throw geminiError;
      }

      const delayMs = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      logger.warn(
        `${label} rate-limited or unavailable (${geminiError.status ?? "network"}), ` +
          `retry ${attempt + 1}/${maxAttempts - 1} in ${delayMs}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError ?? new GeminiApiError(`${label} failed after retries`);
}
