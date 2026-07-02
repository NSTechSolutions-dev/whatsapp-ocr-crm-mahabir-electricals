import Redis from "ioredis";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export const redisConnection: any = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

redisConnection.on("connect", () => {
  logger.info("Connected to Redis");
});

redisConnection.on("error", (err: any) => {
  logger.error("Redis connection error: " + err);
});
