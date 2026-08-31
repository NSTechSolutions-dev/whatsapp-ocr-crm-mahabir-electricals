import { env } from "../config/env";
import { redisConnection } from "../lib/redis";
import { ocrQueue, inventoryScoreQueue } from "./queues";
import { logger } from "../utils/logger";

const RETRY_KEY_PREFIX = "gemini:retry:";
const RETRY_KEY_TTL_SEC = 24 * 60 * 60;

export const GEMINI_RETRY_DELAY_MS = env.GEMINI_AUTO_RETRY_DELAY_MS;
export const MAX_GEMINI_RETRIES = env.GEMINI_AUTO_RETRY_MAX_ATTEMPTS;

export interface ScheduleAutoRetryOptions {
  scopeKey: string;
  retryable: boolean;
  add: (attempt: number) => Promise<unknown>;
}

/**
 * Registers one auto-retry for a query that failed due to a retryable
 * (Gemini) error. Returns the attempt number when another retry was
 * scheduled, or 0 when retrying is not allowed / exhausted.
 */
export async function scheduleAutoRetry(options: ScheduleAutoRetryOptions): Promise<number> {
  if (!options.scopeKey || !options.retryable) return 0;

  const key = `${RETRY_KEY_PREFIX}${options.scopeKey}`;
  const attempt = await redisConnection.incr(key);
  await redisConnection.expire(key, RETRY_KEY_TTL_SEC);

  if (attempt > MAX_GEMINI_RETRIES) {
    await redisConnection.del(key);
    logger.warn(
      `[gemini-auto-retry] ${options.scopeKey} exhausted ${MAX_GEMINI_RETRIES} auto-retries; leaving failed for manual retry`
    );
    return 0;
  }

  await options.add(attempt);

  logger.info(
    `[gemini-auto-retry] ${options.scopeKey} scheduled retry ${attempt}/${MAX_GEMINI_RETRIES} in ${GEMINI_RETRY_DELAY_MS}ms`
  );
  return attempt;
}

export async function clearAutoRetry(scopeKey: string | null | undefined): Promise<void> {
  if (!scopeKey) return;
  await redisConnection.del(`${RETRY_KEY_PREFIX}${scopeKey}`);
}

/**
 * Cancels any pending auto-retry for an ocr:job (used by the manual retry
 * endpoint so a manual retry is not duplicated by a scheduled one).
 */
export async function cancelPendingAutoRetry(
  jobId: string,
  failedStep?: string | null
): Promise<void> {
  const key = `${RETRY_KEY_PREFIX}${jobId}`;
  const attempt = parseInt((await redisConnection.get(key)) || "0", 10);

  if (attempt > 0 && attempt <= MAX_GEMINI_RETRIES) {
    const queue = failedStep === "inventory_score" ? inventoryScoreQueue : ocrQueue;
    const pendingJobId =
      failedStep === "inventory_score"
        ? `inventory-${jobId}-retry-${attempt}`
        : `ocr-${jobId}-retry-${attempt}`;

    try {
      const pendingJob = await queue.getJob(pendingJobId);
      if (pendingJob) {
        const state = await pendingJob.getState();
        if (["delayed", "waiting", "active"].includes(state)) {
          await pendingJob.remove();
          logger.info(`[gemini-auto-retry] removed pending retry job ${pendingJobId}`);
        }
      }
    } catch (error) {
      logger.warn(`[gemini-auto-retry] failed to remove pending retry job ${pendingJobId}: ${error}`);
    }
  }

  await redisConnection.del(key);
}