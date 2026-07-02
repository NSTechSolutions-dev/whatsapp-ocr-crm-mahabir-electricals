import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { buildInventorySearchText } from "../src/utils/product-normalize";

const prisma = new PrismaClient();

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "Admin@1234";

const SAMPLE_INVENTORY = [
  { name: "A4 Copier Paper", aliases: ["a4 paper", "a4", "copier paper"], unit: "Ream", currentRate: 280.0, category: "Paper" },
  { name: "Legal Size Paper", aliases: ["legal paper", "fs paper", "fullscape"], unit: "Ream", currentRate: 320.0, category: "Paper" },
  { name: "Blue Ball Pen", aliases: ["blue pen", "ball pen blue", "bp blue"], unit: "Pcs", currentRate: 8.0, category: "Writing" },
  { name: "Black Ball Pen", aliases: ["black pen", "ball pen black", "bp black"], unit: "Pcs", currentRate: 8.0, category: "Writing" },
  { name: "Whiteboard Marker", aliases: ["wb marker", "marker"], unit: "Pcs", currentRate: 35.0, category: "Writing" },
  { name: "Stapler No. 10", aliases: ["stapler", "small stapler"], unit: "Pcs", currentRate: 65.0, category: "Office" },
  { name: "Stapler Pins No. 10", aliases: ["stapler pins", "pins"], unit: "Box", currentRate: 15.0, category: "Office" },
  { name: "File Folder A4", aliases: ["folder", "file folder", "box file"], unit: "Pcs", currentRate: 45.0, category: "Filing" },
  { name: "Sticky Notes 3x3", aliases: ["post it", "sticky", "sticky notes"], unit: "Pad", currentRate: 55.0, category: "Office" },
  { name: "Notebook 200 Pages", aliases: ["notebook", "register", "long book"], unit: "Pcs", currentRate: 95.0, category: "Books" },
  { name: "Highlighter Yellow", aliases: ["highlighter", "marker yellow"], unit: "Pcs", currentRate: 25.0, category: "Writing" },
  { name: "Glue Stick", aliases: ["glue", "gum stick"], unit: "Pcs", currentRate: 30.0, category: "Office" },
  { name: "Tata Salt 1kg", aliases: ["tata salt", "salt", "namak"], unit: "Kg", currentRate: 28.0, category: "Grocery" },
  { name: "Fortune Mustard Oil 5L", aliases: ["fortune oil", "mustard oil", "sarso oil"], unit: "Litre", currentRate: 780.0, category: "Grocery" },
  { name: "Surf Excel Easy Wash", aliases: ["surf excel", "surf", "detergent"], unit: "Kg", currentRate: 120.0, category: "Grocery" },
];

async function main() {
  // Seed admin user
  const existingAdmin = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
  });

  if (!existingAdmin) {
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
    console.log(`Seeded admin user: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  } else {
    console.log("Admin user already exists");
  }

  // Seed sample inventory
  let seededCount = 0;
  for (const item of SAMPLE_INVENTORY) {
    const existingItem = await prisma.inventory.findUnique({
      where: { name: item.name },
    });

    if (!existingItem) {
      const inv = await prisma.inventory.create({
        data: {
          name: item.name,
          aliases: item.aliases,
          unit: item.unit,
          currentRate: item.currentRate,
          category: item.category,
          searchText: buildInventorySearchText(item.name, item.aliases, item.unit),
        },
      });

      await prisma.rateHistory.create({
        data: {
          inventoryId: inv.id,
          rate: item.currentRate,
          changedBy: "Admin",
        },
      });

      seededCount++;
    } else if (!existingItem.searchText) {
      await prisma.inventory.update({
        where: { id: existingItem.id },
        data: {
          searchText: buildInventorySearchText(existingItem.name, existingItem.aliases, existingItem.unit),
        },
      });
    }
  }

  console.log(`Seeded ${seededCount} new products to inventory`);

  const { ensureAutomationRules } = require("../src/services/automation-rules.bootstrap");
  await ensureAutomationRules();
  console.log("Automation rules bootstrapped (5 fixed types)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
