import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { generateQuotation, isQuotationPdfReady, calculateGstTotals, type GstMode } from "../../services/quotation.service";
import { sendTemplateMessage } from "../../services/whatsapp.service";
import { getQuotationPdfPublicUrl } from "../../utils/public-url";
import { scheduleInquiryFollowup } from "../../services/automation.service";
import { logActivity } from "../../utils/activity";
import { logger } from "../../utils/logger";
import { normalizePhone, normalizePhoneOrNull } from "../../utils/phone";
import {
  ensureConversationForCustomer,
  findOrCreateCustomerByPhone,
} from "../../services/conversation.service";

export type TemplateItemInput = {
  productName: string;
  qty: number;
  unit?: string | null;
  rate?: number | null;
  inventoryId?: string | null;
};

function parseGstMode(value: unknown): GstMode {
  return value === "inclusive" ? "inclusive" : "exclusive";
}

function normalizeItems(raw: unknown): TemplateItemInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = item as Record<string, unknown>;
      const productName = String(row.productName || "").trim();
      const qty = Number(row.qty);
      const rateRaw = row.rate;
      const rate =
        rateRaw === null || rateRaw === undefined || rateRaw === ""
          ? null
          : Number(rateRaw);
      return {
        productName,
        qty: Number.isFinite(qty) && qty > 0 ? qty : 0,
        unit: row.unit != null ? String(row.unit).trim() || null : null,
        rate: rate != null && Number.isFinite(rate) ? rate : null,
        inventoryId: row.inventoryId ? String(row.inventoryId) : null,
      };
    })
    .filter((item) => item.productName && item.qty > 0);
}

function serializeTemplate(template: {
  id: string;
  name: string;
  gstPercent: number;
  gstMode: string;
  deliveryCharge: number;
  items: unknown;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: { id: string; name: string; email: string } | null;
}) {
  const items = normalizeItems(template.items);
  return {
    id: template.id,
    name: template.name,
    gstPercent: template.gstPercent,
    gstMode: template.gstMode,
    deliveryCharge: template.deliveryCharge,
    items,
    itemCount: items.length,
    createdById: template.createdById,
    createdBy: template.createdBy
      ? {
          id: template.createdBy.id,
          name: template.createdBy.name,
          email: template.createdBy.email,
        }
      : undefined,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

async function ensureCustomerConversation(customerId: string): Promise<string> {
  const conversation = await ensureConversationForCustomer(customerId);
  return conversation.id;
}

export async function listQuotationTemplates(req: Request, res: Response) {
  try {
    const templates = await prisma.quotationTemplate.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
    return res.json(templates.map(serializeTemplate));
  } catch (error) {
    logger.error(`listQuotationTemplates: ${error}`);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function getQuotationTemplate(req: Request, res: Response) {
  const { id } = req.params;
  try {
    const template = await prisma.quotationTemplate.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!template) {
      return res.status(404).json({ detail: "Template not found" });
    }
    return res.json(serializeTemplate(template));
  } catch (error) {
    logger.error(`getQuotationTemplate: ${error}`);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function createQuotationTemplate(req: Request, res: Response) {
  const { name, gstPercent, gstMode, deliveryCharge, items } = req.body ?? {};
  const title = String(name || "").trim();
  const normalizedItems = normalizeItems(items);

  if (!title) {
    return res.status(400).json({ detail: "Template name is required" });
  }
  if (!normalizedItems.length) {
    return res.status(400).json({ detail: "At least one line item is required" });
  }

  try {
    const gst = Number(gstPercent);
    const delivery = Number(deliveryCharge);
    const template = await prisma.quotationTemplate.create({
      data: {
        name: title,
        gstPercent: Number.isFinite(gst) ? gst : 18,
        gstMode: parseGstMode(gstMode),
        deliveryCharge: Number.isFinite(delivery) && delivery > 0 ? delivery : 0,
        items: normalizedItems,
        createdById: req.user!.id,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    await logActivity(req.user!.id, "create", "quotation_template", template.id);
    return res.status(201).json(serializeTemplate(template));
  } catch (error) {
    logger.error(`createQuotationTemplate: ${error}`);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function createTemplateFromEnquiry(req: Request, res: Response) {
  const { enquiryId } = req.params;
  const title = String(req.body?.name || "").trim();

  if (!title) {
    return res.status(400).json({ detail: "Template name is required" });
  }

  try {
    const enquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
      include: { items: true },
    });
    if (!enquiry) {
      return res.status(404).json({ detail: "Enquiry not found" });
    }

    const items = normalizeItems(
      enquiry.items.map((item) => ({
        productName: item.productName,
        qty: item.qty,
        unit: item.unit,
        rate: item.rate,
        inventoryId: item.inventoryId,
      }))
    );

    if (!items.length) {
      return res.status(400).json({ detail: "Enquiry has no line items to save" });
    }

    const template = await prisma.quotationTemplate.create({
      data: {
        name: title,
        gstPercent: enquiry.gstPercent ?? 18,
        gstMode: parseGstMode(enquiry.gstMode),
        deliveryCharge: enquiry.deliveryCharge ?? 0,
        items,
        createdById: req.user!.id,
      },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    await logActivity(req.user!.id, "create", "quotation_template", template.id);
    return res.status(201).json(serializeTemplate(template));
  } catch (error) {
    logger.error(`createTemplateFromEnquiry: ${error}`);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function updateQuotationTemplate(req: Request, res: Response) {
  const { id } = req.params;
  const { name, gstPercent, gstMode, deliveryCharge, items } = req.body ?? {};

  try {
    const existing = await prisma.quotationTemplate.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ detail: "Template not found" });
    }

    const data: Record<string, unknown> = {};
    if (name !== undefined) {
      const title = String(name).trim();
      if (!title) return res.status(400).json({ detail: "Template name is required" });
      data.name = title;
    }
    if (gstPercent !== undefined) {
      const gst = Number(gstPercent);
      data.gstPercent = Number.isFinite(gst) ? gst : 18;
    }
    if (gstMode !== undefined) {
      data.gstMode = parseGstMode(gstMode);
    }
    if (deliveryCharge !== undefined) {
      const delivery = Number(deliveryCharge);
      data.deliveryCharge = Number.isFinite(delivery) && delivery > 0 ? delivery : 0;
    }
    if (items !== undefined) {
      const normalizedItems = normalizeItems(items);
      if (!normalizedItems.length) {
        return res.status(400).json({ detail: "At least one line item is required" });
      }
      data.items = normalizedItems;
    }

    const template = await prisma.quotationTemplate.update({
      where: { id },
      data,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });

    await logActivity(req.user!.id, "update", "quotation_template", id);
    return res.json(serializeTemplate(template));
  } catch (error) {
    logger.error(`updateQuotationTemplate: ${error}`);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function deleteQuotationTemplate(req: Request, res: Response) {
  const { id } = req.params;
  try {
    const existing = await prisma.quotationTemplate.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ detail: "Template not found" });
    }
    await prisma.quotationTemplate.delete({ where: { id } });
    await logActivity(req.user!.id, "delete", "quotation_template", id);
    return res.json({ ok: true });
  } catch (error) {
    logger.error(`deleteQuotationTemplate: ${error}`);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

/**
 * Instantiate template as a real Enquiry + Quotation for a customer, then send via WhatsApp.
 */
export async function sendQuotationTemplate(req: Request, res: Response) {
  const { id } = req.params;
  const {
    name,
    phone,
    company,
    billCustomerName,
    billCustomerPhone,
    billCustomerCompany,
    gstPercent: bodyGst,
    gstMode: bodyGstMode,
    deliveryCharge: bodyDeliveryCharge,
  } = req.body ?? {};

  if (!phone || !String(phone).trim()) {
    return res.status(400).json({ detail: "Customer phone is required" });
  }

  try {
    const template = await prisma.quotationTemplate.findUnique({ where: { id } });
    if (!template) {
      return res.status(404).json({ detail: "Template not found" });
    }

    const items = normalizeItems(template.items);
    if (!items.length) {
      return res.status(400).json({ detail: "Template has no line items" });
    }

    const normalizedPhone = normalizePhone(String(phone).trim());
    const customerName = String(name || "").trim() || null;
    const customerCompany = company != null ? String(company).trim() || null : null;

    const customer = await findOrCreateCustomerByPhone(normalizedPhone, {
      name: customerName,
      company: customerCompany,
    });

    const conversationId = await ensureCustomerConversation(customer.id);

    const gstPercent =
      bodyGst !== undefined && bodyGst !== null && Number.isFinite(Number(bodyGst))
        ? Number(bodyGst)
        : template.gstPercent;
    const gstMode = parseGstMode(bodyGstMode ?? template.gstMode);
    const deliveryRaw =
      bodyDeliveryCharge !== undefined ? Number(bodyDeliveryCharge) : template.deliveryCharge;
    const deliveryCharge = Number.isFinite(deliveryRaw) && deliveryRaw > 0 ? deliveryRaw : 0;

    const billName =
      (billCustomerName != null ? String(billCustomerName).trim() : "") ||
      customerName ||
      customer.name;
    const billPhone =
      normalizePhoneOrNull(billCustomerPhone) || normalizedPhone;
    const billCompany =
      (billCustomerCompany != null ? String(billCustomerCompany).trim() : "") ||
      customerCompany ||
      customer.company;

    const enquiry = await prisma.enquiry.create({
      data: {
        conversationId,
        customerId: customer.id,
        createdById: req.user!.id,
        status: "FINALIZED",
        sourceData: `Saved quotation template: ${template.name}`,
        gstPercent,
        gstMode,
        deliveryCharge,
        billCustomerName: billName || null,
        billCustomerPhone: billPhone,
        billCustomerCompany: billCompany || null,
        finalizedAt: new Date(),
        items: {
          create: items.map((item) => ({
            productName: item.productName,
            qty: item.qty,
            unit: item.unit,
            rate: item.rate,
            inventoryId: item.inventoryId,
            confidence: 1,
          })),
        },
      },
    });

    let quotation;
    try {
      quotation = await generateQuotation(enquiry.id, gstPercent, { gstMode });
    } catch (error: any) {
      logger.error(`sendQuotationTemplate: PDF failed for enquiry ${enquiry.id}: ${error?.message || error}`);
      return res.status(400).json({
        detail: error?.message || "Failed to generate quotation PDF",
        enquiryId: enquiry.id,
      });
    }

    if (!(await isQuotationPdfReady(quotation.s3Key))) {
      return res.status(400).json({
        detail: "Quotation PDF is not ready",
        enquiryId: enquiry.id,
        quotationId: quotation.id,
      });
    }

    const pdfProxyUrl = `${getQuotationPdfPublicUrl(quotation.id)}?v=${Date.now()}`;
    const lineItems = items.map((item) => ({
      qty: item.qty,
      rate: item.rate || 0,
    }));
    const { grandTotal } = calculateGstTotals(lineItems, gstPercent, gstMode, deliveryCharge);

    const messageId = await sendTemplateMessage(
      customer.phone,
      "mahabir_quotation_pdf_delivery",
      {
        variables: [quotation.number],
        documentHeader: {
          url: pdfProxyUrl,
          filename: `${quotation.number}.pdf`,
        },
      },
      conversationId
    );

    const now = new Date();
    await prisma.quotation.update({
      where: { id: quotation.id },
      data: { sentAt: now },
    });
    await prisma.enquiry.update({
      where: { id: enquiry.id },
      data: { status: "SENT" },
    });
    await prisma.customer.update({
      where: { id: customer.id },
      data: { updatedAt: now },
    });

    const rules = await prisma.automationRule.findMany({
      where: {
        triggerType: { in: ["inquiry_followup", "inactivity_followup"] },
        isActive: true,
      },
    });
    for (const rule of rules) {
      const triggerParams = rule.triggerParams as Record<string, unknown>;
      const days = Number(triggerParams?.days ?? 3);
      try {
        await scheduleInquiryFollowup(rule.id, customer.id, days, enquiry.id, quotation.number);
      } catch (err: any) {
        logger.warn(
          `sendQuotationTemplate: skipped follow-up for rule ${rule.id}: ${err?.message || err}`
        );
      }
    }

    await logActivity(req.user!.id, "send", "quotation_template", id);

    return res.json({
      ok: true,
      sentAt: now.toISOString(),
      messageId,
      grandTotal,
      templateId: id,
      enquiryId: enquiry.id,
      quotationId: quotation.id,
      quotationNumber: quotation.number,
      conversationId,
      customerId: customer.id,
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        company: customer.company,
      },
    });
  } catch (error: any) {
    logger.error(`sendQuotationTemplate: ${error?.message || error}`);
    return res.status(500).json({ detail: error?.message || "Internal server error" });
  }
}
