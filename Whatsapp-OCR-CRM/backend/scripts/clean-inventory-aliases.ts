/**
 * Remove price suffixes and irrelevant OCR lines from inventory aliases.
 * Usage: npx ts-node scripts/clean-inventory-aliases.ts
 */
import { PrismaClient } from "@prisma/client";
import { buildInventorySearchText, normalizeAliasList } from "../src/utils/product-normalize";
import { invalidateAllMatchCache } from "../src/services/match-cache.service";
import { redisConnection } from "../src/lib/redis";

const prisma = new PrismaClient();

async function main() {
  const items = await prisma.inventory.findMany({ select: { id: true, name: true, aliases: true, unit: true } });
  let updated = 0;

  for (const item of items) {
    const cleaned = normalizeAliasList(item.name, item.aliases);
    if (JSON.stringify(cleaned) === JSON.stringify(item.aliases)) continue;

    await prisma.inventory.update({
      where: { id: item.id },
      data: {
        aliases: cleaned,
        searchText: buildInventorySearchText(item.name, cleaned, item.unit),
      },
    });
    console.log(`${item.name}: [${item.aliases.join(" | ")}] -> [${cleaned.join(" | ")}]`);
    updated++;
  }

  await invalidateAllMatchCache();
  console.log(`Cleaned ${updated}/${items.length} inventory items`);
  await redisConnection.quit();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
