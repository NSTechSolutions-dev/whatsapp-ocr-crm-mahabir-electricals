import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import {
  searchInventory,
  syncInventorySearchText,
  deleteInventoryItem,
  clearAllInventory,
} from "../../services/inventory.service";
import { invalidateAllMatchCache } from "../../services/match-cache.service";
import { triggerPriceDrop } from "../../services/automation.service";
import { logActivity } from "../../utils/activity";
import { logger } from "../../utils/logger";
import { buildInventorySearchText, formatProductName, normalizeAliasList } from "../../utils/product-normalize";
import { queueProductEmbedding } from "../../jobs/embed-product.job";
import { embedQueryCached, embeddingDbReady } from "../../services/embedding.service";
import { findClosestVectorMatch } from "../../repositories/embedding.repository";
import { meetsEmbeddingThreshold } from "../../config/matching";

export async function listInventory(req: Request, res: Response) {
  const q = (req.query.q as string || "").toLowerCase();

  try {
    const items = await prisma.inventory.findMany({
      orderBy: { name: "asc" },
      include: {
        unitRates: true,
      },
    });

    let filtered = items;
    if (q) {
      filtered = items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.aliases.some((a) => a.toLowerCase().includes(q))
      );
    }

    return res.json({ items: filtered });
  } catch (error) {
    logger.error("Error listing inventory: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function search(req: Request, res: Response) {
  const q = req.query.q as string || "";

  try {
    const results = await searchInventory(q, 10);
    return res.json({ items: results });
  } catch (error) {
    logger.error("Error searching inventory: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function vectorSearch(req: Request, res: Response) {
  const q = (req.query.q as string || "").trim();

  if (!q) {
    return res.status(400).json({ detail: "Query parameter q is required" });
  }

  if (!embeddingDbReady) {
    return res.status(503).json({ detail: "Vector search unavailable (pgvector not enabled)" });
  }

  try {
    const { vector } = await embedQueryCached(q);
    if (!vector) {
      return res.status(503).json({ detail: "Embedding generation failed or disabled" });
    }

    const matches = await findClosestVectorMatch(vector, 5);
    const enriched = await Promise.all(
      matches.map(async (match) => {
        const inv = await prisma.inventory.findUnique({
          where: { id: match.inventoryId },
          select: { id: true, name: true, unit: true, currentRate: true, aliases: true },
        });
        return {
          ...match,
          inventory: inv,
          aboveThreshold: meetsEmbeddingThreshold(match.similarity),
        };
      })
    );

    return res.json({ query: q, matches: enriched });
  } catch (error) {
    logger.error("Vector search error: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function createItem(req: Request, res: Response) {
  const { name: rawName, aliases, currentRate, unit, category, unitRates } = req.body;
  const name = formatProductName(String(rawName || ""));

  try {
    if (!name) {
      return res.status(400).json({ detail: "Product name is required" });
    }

    const existing = await prisma.inventory.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });
    if (existing) {
      return res.status(400).json({ detail: "Product name already exists" });
    }

    const resolvedUnitRates =
      unitRates && Array.isArray(unitRates) && unitRates.length > 0
        ? unitRates.map((ur: any) => ({ unit: String(ur.unit).trim(), rate: parseFloat(ur.rate) }))
        : unit && currentRate !== undefined && currentRate !== null
          ? [{ unit: String(unit).trim(), rate: parseFloat(currentRate) }]
          : [];

    const baseUnit = resolvedUnitRates.length > 0 ? resolvedUnitRates[0].unit : unit || null;
    const baseRate =
      resolvedUnitRates.length > 0
        ? resolvedUnitRates[0].rate
        : currentRate !== undefined && currentRate !== null
          ? parseFloat(currentRate)
          : null;

    const finalAliases = normalizeAliasList(name, Array.isArray(aliases) ? aliases : []);

    const item = await prisma.inventory.create({
      data: {
        name,
        aliases: finalAliases,
        searchText: buildInventorySearchText(name, finalAliases, baseUnit),
        currentRate: baseRate,
        unit: baseUnit,
        category: category || null,
        stock: 0,
        lowStockThreshold: 10,
        unitRates: {
          create: resolvedUnitRates,
        },
      },
      include: {
        unitRates: true,
      },
    });

    if (baseRate !== null) {
      await prisma.rateHistory.create({
        data: {
          inventoryId: item.id,
          rate: baseRate,
          changedBy: req.user!.name,
        },
      });
    }

    await queueProductEmbedding({
      inventoryId: item.id,
      name,
      aliases: finalAliases,
      generateAliases: true,
    });

    await invalidateAllMatchCache();
    await logActivity(req.user!.id, "create", "inventory", item.id);
    return res.json(item);
  } catch (error) {
    logger.error("Error creating inventory item: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function updateItem(req: Request, res: Response) {
  const { id } = req.params;
  const { name, aliases, unit, category, currentRate, unitRates } = req.body;

  try {
    const inv = await prisma.inventory.findUnique({ where: { id }, include: { unitRates: true } });
    if (!inv) {
      return res.status(404).json({ detail: "Inventory item not found" });
    }

    const data: any = {};
    if (name !== undefined) data.name = formatProductName(name);
    if (aliases !== undefined) {
      data.aliases = normalizeAliasList(name ?? inv.name, aliases);
    }
    if (category !== undefined) data.category = category;

    const resolvedUnitRates =
      unitRates && Array.isArray(unitRates)
        ? unitRates.map((ur: any) => ({ unit: String(ur.unit).trim(), rate: parseFloat(ur.rate) }))
        : null;

    if (resolvedUnitRates) {
      await prisma.inventoryUnitRate.deleteMany({ where: { inventoryId: id } });
      data.unitRates = {
        create: resolvedUnitRates,
      };
      if (resolvedUnitRates.length > 0) {
        data.unit = resolvedUnitRates[0].unit;
        data.currentRate = resolvedUnitRates[0].rate;
      } else {
        data.unit = null;
        data.currentRate = null;
      }
    } else {
      if (unit !== undefined) data.unit = unit;
      if (currentRate !== undefined) data.currentRate = currentRate !== null ? parseFloat(currentRate) : null;
    }

    const oldRate = inv.currentRate || 0;

    const updated = await prisma.inventory.update({
      where: { id },
      data,
      include: {
        unitRates: true,
      },
    });

    const nextName = data.name ?? inv.name;
    const nextAliases = data.aliases ?? inv.aliases;
    const nextUnit = data.unit !== undefined ? data.unit : inv.unit;
    await syncInventorySearchText(id, nextName, nextAliases, nextUnit);

    const newRate = updated.currentRate;
    if (newRate !== null && newRate !== oldRate) {
      await prisma.rateHistory.create({
        data: {
          inventoryId: id,
          rate: newRate,
          changedBy: req.user!.name,
        },
      });
      if (newRate < oldRate) {
        await triggerPriceDrop(id, oldRate, newRate);
      }
    }

    if (name !== undefined || aliases !== undefined) {
      await queueProductEmbedding({
        inventoryId: id,
        name: nextName,
        aliases: nextAliases,
        generateAliases: false,
      });
    }

    await invalidateAllMatchCache();
    await logActivity(req.user!.id, "update", "inventory", id);
    return res.json(updated);
  } catch (error) {
    logger.error(`Error updating inventory item ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function updateRate(req: Request, res: Response) {
  const { id } = req.params;
  const { rate } = req.body;

  if (rate === undefined || rate === null) {
    return res.status(400).json({ detail: "Rate is required" });
  }

  try {
    const inv = await prisma.inventory.findUnique({ where: { id } });
    if (!inv) {
      return res.status(404).json({ detail: "Inventory product not found" });
    }

    const oldRate = inv.currentRate || 0;
    const newRate = parseFloat(rate);

    await prisma.inventory.update({
      where: { id },
      data: {
        currentRate: newRate,
      },
    });

    await prisma.rateHistory.create({
      data: {
        inventoryId: id,
        rate: newRate,
        changedBy: req.user!.name,
      },
    });

    if (oldRate && newRate < oldRate) {
      await triggerPriceDrop(id, oldRate, newRate);
    }

    await logActivity(req.user!.id, "update_rate", "inventory", id);
    await invalidateAllMatchCache();
    return res.json({ ok: true, currentRate: newRate });
  } catch (error) {
    logger.error(`Error updating rate for ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function deleteItem(req: Request, res: Response) {
  const { id } = req.params;

  try {
    const inv = await prisma.inventory.findUnique({ where: { id } });
    if (!inv) {
      return res.status(404).json({ detail: "Inventory item not found" });
    }

    await deleteInventoryItem(id);
    await invalidateAllMatchCache();
    await logActivity(req.user!.id, "delete", "inventory", id);
    return res.json({ ok: true });
  } catch (error) {
    logger.error(`Error deleting inventory item ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function clearInventory(req: Request, res: Response) {
  try {
    const deleted = await clearAllInventory();
    await invalidateAllMatchCache();
    await logActivity(req.user!.id, "clear", "inventory", "all");
    return res.json({ ok: true, deleted });
  } catch (error) {
    logger.error("Error clearing inventory: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function rateHistory(req: Request, res: Response) {
  const { id } = req.params;

  try {
    const items = await prisma.rateHistory.findMany({
      where: { inventoryId: id },
      orderBy: { recordedAt: "desc" },
      take: 200,
    });
    return res.json({ items });
  } catch (error) {
    logger.error(`Error retrieving rate history for ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}
