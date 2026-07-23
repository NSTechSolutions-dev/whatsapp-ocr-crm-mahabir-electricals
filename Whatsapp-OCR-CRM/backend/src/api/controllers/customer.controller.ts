import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { logger } from "../../utils/logger";
import { triggerClosedReview } from "../../services/automation.service";
import { looksLikePhoneQuery, normalizePhoneForSearch } from "../../utils/phone";

export async function listCustomers(req: Request, res: Response) {
  const q = (req.query.q as string || "").toLowerCase();

  try {
    const customers = await prisma.customer.findMany({
      where: { hiddenFromPipeline: false },
      orderBy: { updatedAt: "desc" },
    });

    const enriched = [];
    for (const c of customers) {
      const enquiryCount = await prisma.enquiry.count({ where: { customerId: c.id } });
      const lastEnquiry = await prisma.enquiry.findFirst({
        where: { customerId: c.id },
        orderBy: { createdAt: "desc" },
      });

      const lastActivity = lastEnquiry ? lastEnquiry.createdAt.toISOString() : c.updatedAt.toISOString();

      enriched.push({
        ...c,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        enquiryCount,
        lastActivity,
      });
    }

    let filtered = enriched;
    if (q) {
      const normalizedPhoneQuery = looksLikePhoneQuery(q) ? normalizePhoneForSearch(q) : "";
      filtered = enriched.filter(
        (c) =>
          (normalizedPhoneQuery && c.phone === normalizedPhoneQuery) ||
          c.phone.toLowerCase().includes(q) ||
          (c.name && c.name.toLowerCase().includes(q)) ||
          (c.company && c.company.toLowerCase().includes(q))
      );
    }

    return res.json({ items: filtered });
  } catch (error) {
    logger.error("Error listing customers: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function getCustomer(req: Request, res: Response) {
  const { id } = req.params;

  try {
    const cust = await prisma.customer.findUnique({ where: { id } });
    if (!cust) {
      return res.status(404).json({ detail: "Customer not found" });
    }

    const enquiries = await prisma.enquiry.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      include: {
        quotation: true,
        items: true,
        _count: { select: { images: true } },
      },
    });

    const productCounts: { [name: string]: number } = {};
    const enrichedEnquiries = enquiries.map((e) => {
      e.items.forEach((it) => {
        productCounts[it.productName] = (productCounts[it.productName] || 0) + 1;
      });
      return {
        id: e.id,
        conversationId: e.conversationId,
        customerId: e.customerId,
        status: e.status,
        createdById: e.createdById,
        finalizedAt: e.finalizedAt?.toISOString() || null,
        processAt: e.processAt?.toISOString() || null,
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
        itemsCount: e.items.length,
        imageCount: e._count.images,
        quotation: e.quotation,
      };
    });

    const convs = await prisma.conversation.findMany({ where: { customerId: id } });
    const convIds = convs.map((c) => c.id);

    const messages = await prisma.whatsappMessage.findMany({
      where: { conversationId: { in: convIds } },
      orderBy: { createdAt: "asc" },
    });

    const quotationCount = enrichedEnquiries.filter(
      (e) => e.quotation && (e.quotation as { sentAt?: Date | string | null }).sentAt
    ).length;
    const topProducts = Object.entries(productCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return res.json({
      customer: {
        ...cust,
        createdAt: cust.createdAt.toISOString(),
        updatedAt: cust.updatedAt.toISOString(),
      },
      stats: {
        totalEnquiries: enrichedEnquiries.length,
        quotationsSent: quotationCount,
        lastActivity: enrichedEnquiries.length > 0 ? enrichedEnquiries[0].createdAt : cust.updatedAt.toISOString(),
      },
      enquiries: enrichedEnquiries,
      messages,
      topProducts,
    });
  } catch (error) {
    logger.error(`Error retrieving customer ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function updateCustomerStage(req: Request, res: Response) {
  const { id } = req.params;
  const { stage } = req.body;

  if (!stage) {
    return res.status(400).json({ detail: "Stage is required" });
  }

  try {
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      return res.status(404).json({ detail: "Customer not found" });
    }

    const previousStage = customer.stage;
    const updatedCustomer = await prisma.customer.update({
      where: { id },
      data: { stage },
    });

    // Fire Google review automation only when newly moved to Closed
    if (stage === "Closed" && previousStage !== "Closed") {
      try {
        const result = await triggerClosedReview(updatedCustomer.id);
        logger.info(
          `closed_review after stage change for ${updatedCustomer.id}: queued=${result.queued} skipped=${result.skipped}`
        );
      } catch (err) {
        logger.warn(`closed_review trigger failed for ${updatedCustomer.id}: ${err}`);
      }
    }

    return res.json({
      customer: {
        ...updatedCustomer,
        createdAt: updatedCustomer.createdAt.toISOString(),
        updatedAt: updatedCustomer.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    logger.error(`Error updating customer stage ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function hideCustomerFromPipeline(req: Request, res: Response) {
  const { id } = req.params;

  try {
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      return res.status(404).json({ detail: "Customer not found" });
    }

    await prisma.customer.update({
      where: { id },
      data: { hiddenFromPipeline: true },
    });

    return res.json({ ok: true });
  } catch (error) {
    logger.error(`Error hiding customer ${id} from pipeline: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}
