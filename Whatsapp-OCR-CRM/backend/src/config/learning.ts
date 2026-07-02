import { env } from "./env";

/** Minimum confirmations before a learned mapping is used in the matching pipeline. */
export const LEARNING_MIN_HITS = env.LEARNING_MIN_HITS;

export function learningEnabled(): boolean {
  return env.LEARNING_ENABLED;
}
