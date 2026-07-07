import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { syncInventorySearchText } from "../../services/inventory.service";
import { extractAndMatchProducts } from "../../services/matching.service";
import { matchProductViaPipeline } from "../../services/quotation-pipeline.service";
import { quotationQueue } from "../../jobs/queues";
import { logActivity } from "../../utils/activity";
import { logger } from "../../utils/logger";
import { createSystemNotification } from "../../utils/notification";
import { buildInventorySearchText, deriveAliasesFromRaw, formatProductName, normalizeAliasList } from "../../utils/product-normalize";
import { learnFromCorrections, learnFromEnquiry } from "../../services/learning.service";
import { GeminiApiError } from "../../lib/gemini-retry";
import { ProductExtractionError } from "../../services/product-extraction.service";

async function enrichEnquiry(enquiryId: string) {
  const e = await prisma.enquiry.findUnique({
    where: { id: enquiryId },
    include: {
      customer: true,
      createdBy: {
        select: { id: true, name: true, email: true, role: true },
      },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          inventory: {
            include: {
              unitRates: true
            }
          },
        },
      },
      quotation: true,
      conversation: true,
    },
  });

  // Add matchType to items based on inventory mapping
  if (e && e.items) {
    (e as any).items = e.items.map((item: any) => ({
      ...item,
      matchType: item.inventoryId ? (item.confidence >= 0.95 ? "exact" : "fuzzy") : "new",
      matchScore: item.inventoryId ? item.confidence : 0,
    }));
  }

  return e;
}

export async function createEnquiry(req: Request, res: Response) {
  const { conversationId, customerId, items } = req.body;

  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) {
      return res.status(404).json({ detail: "Conversation not found" });
    }

    const resolvedCustomerId = customerId || conv.customerId;

    const enquiry = await prisma.enquiry.create({
      data: {
        conversationId,
        customerId: resolvedCustomerId,
        createdById: req.user!.id,
      },
    });

    for (const item of items || []) {
      let rate = item.rate;
      let unit = item.unit;
      let invId = item.inventoryId;
      let autoInvId = item.inventoryId ?? null;
      let matchType = item.matchType;
      let matchScore = item.matchScore;

      if (invId) {
        const inv = await prisma.inventory.findUnique({ where: { id: invId } });
        if (rate === undefined || rate === null) rate = inv?.currentRate || null;
        if (!unit) unit = inv?.unit || null;
        if (!matchType) matchType = "exact";
        if (matchScore === undefined || matchScore === null) matchScore = 1.0;
      } else {
        const match = await matchProductViaPipeline({
          name: item.productName,
          qty: parseFloat(item.qty) || 1,
          unit: item.unit || null,
          raw: item.rawText || item.productName,
        });
        autoInvId = match.inventoryId;
        if (rate === undefined || rate === null) rate = match.rate;
        if (!unit) unit = match.unit;
        invId = match.inventoryId;
        if (!matchType) matchType = match.matchType;
        if (matchScore === undefined || matchScore === null) matchScore = match.matchScore;
      }

      await prisma.enquiryItem.create({
        data: {
          enquiryId: enquiry.id,
          inventoryId: invId,
          autoInventoryId: autoInvId,
          rawText: item.rawText || null,
          productName: item.productName,
          qty: parseFloat(item.qty),
          unit,
          rate,
          confidence: parseFloat(item.confidence || 1.0),
        },
      });
    }

    await logActivity(req.user!.id, "create", "enquiry", enquiry.id);
    const enriched = await enrichEnquiry(enquiry.id);
    return res.json(enriched);
  } catch (error) {
    logger.error("Error creating enquiry: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function listEnquiries(req: Request, res: Response) {
  const limit = parseInt(req.query.limit as string) || 100;
  const conversationId = req.query.conversationId as string | undefined;

  try {
    const enquiries = await prisma.enquiry.findMany({
      where: conversationId ? { conversationId } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        customer: true,
        _count: {
          select: { items: true },
        },
      },
    });

    const result = enquiries.map((e) => ({
      id: e.id,
      conversationId: e.conversationId,
      customerId: e.customerId,
      status: e.status,
      createdById: e.createdById,
      finalizedAt: e.finalizedAt?.toISOString() || null,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      customer: e.customer,
      itemsCount: e._count.items,
    }));

    return res.json({ items: result });
  } catch (error) {
    logger.error("Error listing enquiries: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function getEnquiry(req: Request, res: Response) {
  const { id } = req.params;

  try {
    const enriched = await enrichEnquiry(id);
    if (!enriched) {
      return res.status(404).json({ detail: "Enquiry not found" });
    }
    return res.json(enriched);
  } catch (error) {
    logger.error(`Error retrieving enquiry ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

async function replaceEnquiryItems(enquiryId: string, items: any[]) {
  await prisma.enquiryItem.deleteMany({ where: { enquiryId } });

  for (const item of items || []) {
    if (!item.productName?.trim()) continue;

    await prisma.enquiryItem.create({
      data: {
        enquiryId,
        inventoryId: item.inventoryId || null,
        autoInventoryId: item.autoInventoryId ?? item.inventoryId ?? null,
        rawText: item.rawText || null,
        productName: formatProductName(item.productName),
        qty: parseFloat(String(item.qty ?? 0)) || 0,
        unit: item.unit || null,
        rate: item.rate !== undefined && item.rate !== null && item.rate !== "" ? parseFloat(String(item.rate)) : null,
        confidence: parseFloat(String(item.confidence ?? 1.0)),
      },
    });
  }
}

async function ensureInventoryForNewItems(enquiryId: string) {
  const items = await prisma.enquiryItem.findMany({
    where: { enquiryId, inventoryId: null },
  });

  for (const item of items) {
    const name = formatProductName(item.productName?.trim() || "");
    if (!name) continue;

    let inv = await prisma.inventory.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });

    if (!inv) {
      const aliases = deriveAliasesFromRaw(name, item.rawText);
      try {
        inv = await prisma.inventory.create({
          data: {
            name,
            unit: item.unit || null,
            currentRate: item.rate ?? null,
            aliases,
            searchText: buildInventorySearchText(name, aliases, item.unit || null),
          },
        });
      } catch (error: any) {
        if (error?.code === "P2002") {
          inv = await prisma.inventory.findFirst({
            where: { name: { equals: name, mode: "insensitive" } },
          });
        }
        if (!inv) throw error;
      }
    } else {
      const aliases = normalizeAliasList(name, [...inv.aliases, ...deriveAliasesFromRaw(name, item.rawText)]);
      if (JSON.stringify(aliases) !== JSON.stringify(inv.aliases)) {
        await prisma.inventory.update({
          where: { id: inv.id },
          data: { aliases },
        });
        await syncInventorySearchText(inv.id, inv.name, aliases, inv.unit);
      }

      if (item.rate != null && inv.currentRate == null) {
        await prisma.inventory.update({
          where: { id: inv.id },
          data: {
            currentRate: item.rate,
            unit: item.unit || inv.unit,
          },
        });
        await syncInventorySearchText(inv.id, inv.name, aliases, item.unit || inv.unit);
      }
    }

    await prisma.enquiryItem.update({
      where: { id: item.id },
      data: { inventoryId: inv.id, productName: name },
    });
  }
}

export async function updateEnquiry(req: Request, res: Response) {
  const { id } = req.params;
  const { items } = req.body;

  try {
    const e = await prisma.enquiry.findUnique({ where: { id } });
    if (!e) {
      return res.status(404).json({ detail: "Enquiry not found" });
    }

    if (e.status === "FINALIZED" || e.status === "SENT") {
      return res.status(400).json({ detail: "Cannot edit a finalized enquiry" });
    }

    const oldItems = await prisma.enquiryItem.findMany({ where: { enquiryId: id } });
    await replaceEnquiryItems(id, items);
    await learnFromCorrections(id, oldItems, items || []);

    await prisma.enquiry.update({
      where: { id },
      data: { status: "REVIEW" },
    });

    await logActivity(req.user!.id, "update", "enquiry", id);
    const enriched = await enrichEnquiry(id);
    return res.json(enriched);
  } catch (error) {
    logger.error(`Error updating enquiry ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function finalizeEnquiry(req: Request, res: Response) {
  const { id } = req.params;
  const gstPercent = parseFloat(String(req.body?.gstPercent ?? req.query.gstPercent ?? 18)) || 18;
  const items = req.body?.items;

  try {
    const e = await prisma.enquiry.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!e) {
      return res.status(404).json({ detail: "Enquiry not found" });
    }

    if (e.status === "IGNORED") {
      return res.status(400).json({ detail: "Ignored enquiries cannot be finalized" });
    }

    if (e.status === "FINALIZED" || e.status === "SENT") {
      return res.status(400).json({ detail: "Enquiry already finalized" });
    }

    // Persist latest edits atomically before generating quotation
    if (Array.isArray(items)) {
      await replaceEnquiryItems(id, items);
    }

    const refreshed = await prisma.enquiry.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!refreshed || refreshed.items.length === 0) {
      return res.status(400).json({ detail: "Enquiry has no items to finalize" });
    }

    // Create inventory records for new/unmapped products with user-entered details
    await ensureInventoryForNewItems(id);

    // Learn durable mappings from user-confirmed enquiry lines
    await learnFromEnquiry(id, "FINALIZE");

    const finalItems = await prisma.enquiryItem.findMany({
      where: { enquiryId: id, inventoryId: { not: null } },
    });

    await prisma.$transaction(async (tx) => {
      const byInv = new Map<string, number>();
      for (const item of finalItems) {
        if (!item.inventoryId) continue;
        byInv.set(item.inventoryId, (byInv.get(item.inventoryId) ?? 0) + item.qty);
      }

      if (byInv.size > 0) {
        const invs = await tx.inventory.findMany({
          where: { id: { in: [...byInv.keys()] } },
        });
        await Promise.all(
          invs.map((inv) =>
            tx.inventory.update({
              where: { id: inv.id },
              data: { stock: Math.max(0, inv.stock - (byInv.get(inv.id) ?? 0)) },
            })
          )
        );
      }

      await tx.enquiry.update({
        where: { id },
        data: {
          status: "FINALIZED",
          finalizedAt: new Date(),
        },
      });
    });

    let bullJobId = `quote-${id}`;
    const existingQuoteJob = await quotationQueue.getJob(bullJobId);
    if (existingQuoteJob) {
      const state = await existingQuoteJob.getState();
      if (state === "active") {
        const started = existingQuoteJob.processedOn;
        if (started && Date.now() - started > 5 * 60 * 1000) {
          await existingQuoteJob.remove();
          bullJobId = `quote-${id}-${Date.now()}`;
        }
      } else if (["completed", "failed", "waiting", "delayed"].includes(state)) {
        await existingQuoteJob.remove();
      }
    }

    await quotationQueue.add(
      "generate",
      { enquiryId: id, gstPercent },
      { jobId: bullJobId, removeOnComplete: true }
    );

    await logActivity(req.user!.id, "finalize", "enquiry", id);
    return res.json({ ok: true, enquiryId: id, quotationPending: true });
  } catch (error: any) {
    logger.error(`Error finalizing enquiry ${id}: ` + error);
    const message =
      env.NODE_ENV === "development" && error?.message
        ? `Finalize failed: ${error.message}`
        : "Internal server error";
    return res.status(500).json({ detail: message });
  }
}

export async function reparseSourceData(req: Request, res: Response) {
  const { id } = req.params;
  const { rawText } = req.body;

  try {
    const enquiry = await prisma.enquiry.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!enquiry) {
      return res.status(404).json({ detail: "Enquiry not found" });
    }

    if (enquiry.status !== "DRAFT" && enquiry.status !== "IGNORED") {
      return res.status(400).json({ detail: "Can only reparse DRAFT or IGNORED enquiries" });
    }

    const textToParse = rawText || enquiry.sourceData;
    if (!textToParse) {
      return res.status(400).json({ detail: "No source data to parse" });
    }

    // Extract and match products from raw text
    const matchedItems = await extractAndMatchProducts(textToParse);

    // Delete existing items
    await prisma.enquiryItem.deleteMany({
      where: { enquiryId: id },
    });

    // Create new items
    for (const item of matchedItems) {
      await prisma.enquiryItem.create({
        data: {
          enquiryId: id,
          inventoryId: item.inventoryId,
          autoInventoryId: item.inventoryId,
          productName: item.matchedName || item.product,
          qty: item.qty,
          unit: item.unit || "Pcs",
          rate: item.rate,
          confidence: item.confidence,
          rawText: item.raw,
        },
      });
    }

    // Update source data and promote IGNORED → DRAFT if items found
    const updateData: { sourceData?: string; status?: "DRAFT" } = {};
    if (rawText) {
      updateData.sourceData = rawText;
    }
    if (matchedItems.length > 0 && enquiry.status === "IGNORED") {
      updateData.status = "DRAFT";
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.enquiry.update({
        where: { id },
        data: updateData,
      });
    }

    await logActivity(req.user!.id, "reparse", "enquiry", id);
    
    const enriched = await enrichEnquiry(id);
    return res.json(enriched);
  } catch (error: any) {
    logger.error(`Error reparsing enquiry ${id}: ` + error);
    const retryable =
      error instanceof GeminiApiError
        ? error.retryable
        : error instanceof ProductExtractionError
          ? error.retryable
          : false;
    const status = retryable ? 503 : 500;
    return res.status(status).json({
      detail: error?.message || "Gemini processing failed",
      retryable,
    });
  }
}
