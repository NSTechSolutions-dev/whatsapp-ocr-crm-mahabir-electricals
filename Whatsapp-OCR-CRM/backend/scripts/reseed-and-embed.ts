/**
 * Wipe inventory embeddings and catalogue, reseed, then queue Gemini embeddings.
 * Usage: npx ts-node scripts/reseed-and-embed.ts
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { buildInventorySearchText } from "../src/utils/product-normalize";
import { embedProductQueue } from "../src/jobs/queues";
import { redisConnection } from "../src/lib/redis";
import { embedProductWorker } from "../src/jobs/embed-product.job";
import { setEmbeddingDbReady } from "../src/services/embedding.service";
import { env } from "../src/config/env";

const prisma = new PrismaClient();

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "Admin@1234";

const SAMPLE_INVENTORY = [
  { name: "A4 Copier Paper", aliases: ["a4 paper", "a4", "copier paper", "xerox paper"], unit: "Ream", currentRate: 280.0, category: "Paper" },
  { name: "Legal Size Paper", aliases: ["legal paper", "fs paper", "fullscape"], unit: "Ream", currentRate: 320.0, category: "Paper" },
  { name: "Blue Ball Pen", aliases: ["blue pen", "ball pen blue", "bp blue"], unit: "Pcs", currentRate: 8.0, category: "Writing" },
  { name: "Black Ball Pen", aliases: ["black pen", "ball pen black", "bp black"], unit: "Pcs", currentRate: 8.0, category: "Writing" },
  { name: "Whiteboard Marker", aliases: ["wb marker", "marker"], unit: "Pcs", currentRate: 35.0, category: "Writing" },
  { name: "Stapler No. 10", aliases: ["stapler", "small stapler"], unit: "Pcs", currentRate: 65.0, category: "Office" },
  { name: "Stapler Pins No. 10", aliases: ["stapler pins", "pins", "pin box"], unit: "Box", currentRate: 15.0, category: "Office" },
  { name: "File Folder A4", aliases: ["folder", "file folder", "box file"], unit: "Pcs", currentRate: 45.0, category: "Filing" },
  { name: "Sticky Notes 3x3", aliases: ["post it", "sticky", "sticky notes"], unit: "Pad", currentRate: 55.0, category: "Office" },
  { name: "Notebook 200 Pages", aliases: ["notebook", "register", "long book"], unit: "Pcs", currentRate: 95.0, category: "Books" },
  { name: "Highlighter Yellow", aliases: ["highlighter", "marker yellow"], unit: "Pcs", currentRate: 25.0, category: "Writing" },
  { name: "Glue Stick", aliases: ["glue", "gum stick"], unit: "Pcs", currentRate: 30.0, category: "Office" },
  { name: "Tata Salt 1kg", aliases: ["tata salt", "salt", "namak"], unit: "Kg", currentRate: 28.0, category: "Grocery" },
  { name: "Fortune Mustard Oil 5L", aliases: ["fortune oil", "mustard oil", "sarso oil"], unit: "Litre", currentRate: 780.0, category: "Grocery" },
  { name: "Surf Excel Easy Wash", aliases: ["surf excel", "surf", "detergent"], unit: "Kg", currentRate: 120.0, category: "Grocery" },
];

async function ensurePgVector(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS vector;");
    setEmbeddingDbReady(true);
    console.log("pgvector extension ready");
  } catch (error) {
    setEmbeddingDbReady(false);
    console.warn("pgvector not available:", error);
  }
}

async function wipeCatalogue(): Promise<void> {
  console.log("Wiping old inventory and embeddings...");
  await prisma.quotation.deleteMany();
  await prisma.productEmbedding.deleteMany();
  await prisma.enquiryItem.deleteMany();
  await prisma.enquiry.deleteMany();
  await prisma.rateHistory.deleteMany();
  await prisma.inventoryUnitRate.deleteMany();
  await prisma.inventory.deleteMany();
}

async function seedAdmin(): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!existing) {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await prisma.user.create({
      data: {
        name: "Admin",
        email: ADMIN_EMAIL,
        passwordHash,
        role: "ADMIN",
        isActive: true,
      },
    });
    console.log(`Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  }
}

async function seedInventory(): Promise<string[]> {
  const ids: string[] = [];
  for (const item of SAMPLE_INVENTORY) {
    const inv = await prisma.inventory.create({
      data: {
        name: item.name,
        aliases: item.aliases,
        unit: item.unit,
        currentRate: item.currentRate,
        category: item.category,
        searchText: buildInventorySearchText(item.name, item.aliases, item.unit),
        unitRates: {
          create: [{ unit: item.unit, rate: item.currentRate }],
        },
      },
    });

    await prisma.rateHistory.create({
      data: {
        inventoryId: inv.id,
        rate: item.currentRate,
        changedBy: "reseed",
      },
    });

    ids.push(inv.id);

    await embedProductQueue.add("syncEmbeddings", {
      inventoryId: inv.id,
      name: item.name,
      aliases: item.aliases,
      generateAliases: false,
    });
  }

  console.log(`Seeded ${ids.length} inventory items`);
  return ids;
}

async function waitForEmbeddings(expectedMin: number, timeoutMs = 120000): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const count = await prisma.productEmbedding.count();
    process.stdout.write(`\rEmbeddings: ${count}/${expectedMin}   `);
    if (count >= expectedMin) {
      console.log("\nEmbedding backfill complete");
      return count;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  const final = await prisma.productEmbedding.count();
  console.warn(`\nTimeout waiting for embeddings (${final}/${expectedMin})`);
  return final;
}

async function main() {
  await ensurePgVector();
  await wipeCatalogue();
  await seedAdmin();
  await seedInventory();

  const hasGemini = !!(env.GEMINI_API_KEY && !env.GEMINI_API_KEY.includes("placeholder"));
  const expected = hasGemini ? SAMPLE_INVENTORY.length * 2 : 0;

  if (hasGemini) {
    const count = await waitForEmbeddings(expected);
    if (count < SAMPLE_INVENTORY.length) {
      console.error("Reseed incomplete — check GEMINI_API_KEY");
      process.exit(1);
    }
  } else {
    console.log("GEMINI_API_KEY not set — catalogue seeded, embeddings skipped (trigram search still works)");
  }

  await embedProductWorker.close();
  await redisConnection.quit();
  await prisma.$disconnect();
  console.log("Reseed finished successfully");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
