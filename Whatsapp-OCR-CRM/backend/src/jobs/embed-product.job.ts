import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";
import { generateAliasesForProduct } from "../services/alias.service";
import { embedTexts, embeddingDbReady } from "../services/embedding.service";
import { upsertProductEmbeddings } from "../repositories/embedding.repository";
import { buildInventorySearchText } from "../utils/product-normalize";
import { invalidateMatchCacheOnly } from "../services/match-cache.service";
import { embedProductQueue } from "./queues";

export interface EmbedProductJobData {
  inventoryId: string;
  name: string;
  aliases?: string[];
  generateAliases?: boolean;
}

export const embedProductWorker = new Worker(
  "embedProductQueue",
  async (job) => {
    const { inventoryId, name, aliases = [], generateAliases = false } = job.data as EmbedProductJobData;

    if (!embeddingDbReady) {
      logger.warn(`embedProductWorker skipped ${inventoryId}: pgvector not ready`);
      return;
    }

    let finalAliases = [...aliases];

    if (generateAliases) {
      try {
        const aiAliases = await generateAliasesForProduct(name);
        finalAliases = Array.from(new Set([...finalAliases, ...aiAliases])).filter(Boolean);

        await prisma.inventory.update({
          where: { id: inventoryId },
          data: {
            aliases: finalAliases,
            searchText: buildInventorySearchText(
              name,
              finalAliases,
              (await prisma.inventory.findUnique({ where: { id: inventoryId }, select: { unit: true } }))?.unit
            ),
          },
        });
      } catch (error: any) {
        logger.warn(`Alias generation failed for ${inventoryId}: ${error.message}`);
      }
    }

    const texts = Array.from(new Set([name, ...finalAliases])).filter(Boolean);
    const vectors = await embedTexts(texts);

    const entries: { text: string; vector: number[] }[] = [];
    for (let i = 0; i < texts.length; i++) {
      const vector = vectors[i];
      if (vector) {
        entries.push({ text: texts[i], vector });
      }
    }

    if (entries.length === 0) {
      logger.warn(`No embeddings generated for inventory ${inventoryId}`);
      return;
    }

    const saved = await upsertProductEmbeddings(inventoryId, entries);
    await invalidateMatchCacheOnly();
    logger.info(`Embedded inventory ${inventoryId}: ${saved} vector(s) for "${name}"`);
  },
  {
    connection: redisConnection,
    concurrency: 1,
    limiter: { max: 3, duration: 1000 },
  }
);

export async function queueProductEmbedding(data: EmbedProductJobData): Promise<void> {
  await embedProductQueue.add("syncEmbeddings", data, {
    jobId: `embed-${data.inventoryId}-${Date.now()}`,
  });
}
