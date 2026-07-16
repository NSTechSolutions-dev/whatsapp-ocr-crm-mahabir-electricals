// Trigger nodemon restart after db push
import http from "http";
import { Server } from "socket.io";
import app from "./app";
import { env } from "./config/env";
import { redisConnection } from "./lib/redis";
import { prisma } from "./lib/prisma";
import { logger } from "./utils/logger";
import { buildInventorySearchText, normalizeAliasList } from "./utils/product-normalize";
import { setEmbeddingDbReady } from "./services/embedding.service";

// Import workers to start listening to queues
import { ocrWorker } from "./jobs/ocr.job";
import { quotationWorker } from "./jobs/quotation.job";
import { whatsappWorker } from "./jobs/whatsapp.job";
import { automationWorker } from "./jobs/automation.job";
import { inboundWorker } from "./jobs/inbound.job";
import { inventoryScoreWorker } from "./jobs/inventory-score.job";
import { embedProductWorker } from "./jobs/embed-product.job";
import { inquiryBatchWorker } from "./jobs/inquiry-batch.job";
import { initAutomationCron, stopAllAutomationCron } from "./jobs/automation-cron";
import { startInquiryBatchPoller, stopInquiryBatchPoller } from "./jobs/inquiry-batch-poller";
import { ensureAutomationRules } from "./services/automation-rules.bootstrap";

import { setIo } from "./utils/notification";

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: env.FRONTEND_URL,
    credentials: true,
  },
});

setIo(io);

// Store references on express app
app.set("redis", redisConnection);
app.set("io", io);

// Socket.io Connection Logic
io.on("connection", (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  socket.on("join_conversation", (conversationId: string) => {
    socket.join(`conversation:${conversationId}`);
    logger.debug(`Socket ${socket.id} joined conversation room: ${conversationId}`);
  });

  socket.on("leave_conversation", (conversationId: string) => {
    socket.leave(`conversation:${conversationId}`);
    logger.debug(`Socket ${socket.id} left conversation room: ${conversationId}`);
  });

  socket.on("disconnect", () => {
    logger.info(`Socket disconnected: ${socket.id}`);
  });
});

async function backfillInventorySearchText() {
  const items = await prisma.inventory.findMany({
    select: { id: true, name: true, aliases: true, unit: true, searchText: true },
  });

  let updated = 0;
  for (const item of items) {
    const normalizedAliases = normalizeAliasList(item.name, item.aliases);
    const expected = buildInventorySearchText(item.name, normalizedAliases, item.unit);
    const aliasesChanged =
      JSON.stringify(normalizedAliases) !== JSON.stringify(item.aliases ?? []);
    if (aliasesChanged || item.searchText !== expected) {
      await prisma.inventory.update({
        where: { id: item.id },
        data: {
          aliases: normalizedAliases,
          searchText: expected,
        },
      });
      updated++;
    }
  }

  if (updated > 0) {
    logger.info(`Backfilled inventory search text / aliases for ${updated} item(s)`);
  }
}

async function initVectorExtension(): Promise<boolean> {
  try {
    await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS vector;");
    setEmbeddingDbReady(true);
    logger.info("pgvector extension ready — embedding search enabled");
    return true;
  } catch (error) {
    setEmbeddingDbReady(false);
    logger.warn(`pgvector extension unavailable — embedding search disabled: ${error}`);
    return false;
  }
}

async function main() {
  try {
    await prisma.$connect();
    await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
    await initVectorExtension();
    await backfillInventorySearchText();
    await ensureAutomationRules();
    await initAutomationCron();
    startInquiryBatchPoller();
    logger.info("Database connection established");

    server.listen(env.PORT, () => {
      logger.info(`🚀 Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
    });
  } catch (error) {
    logger.error("Failed to start server: " + error);
    process.exit(1);
  }
}

// Graceful Shutdown Handler
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  server.close(async () => {
    logger.info("HTTP server closed");

    try {
      await ocrWorker.close();
      await quotationWorker.close();
      await whatsappWorker.close();
      await automationWorker.close();
      await inboundWorker.close();
      await inventoryScoreWorker.close();
      await embedProductWorker.close();
      await inquiryBatchWorker.close();
      stopInquiryBatchPoller();
      stopAllAutomationCron();
      logger.info("BullMQ workers closed");

      await redisConnection.quit();
      logger.info("Redis connection closed");

      await prisma.$disconnect();
      logger.info("Prisma client disconnected");

      process.exit(0);
    } catch (err) {
      logger.error("Error during graceful shutdown: " + err);
      process.exit(1);
    }
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main();
