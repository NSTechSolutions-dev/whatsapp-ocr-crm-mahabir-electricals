import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { getPresignedUrl } from "../../lib/s3";
import { sendTemplateMessage } from "../../services/whatsapp.service";
import {
  regenerateQuotationPdf,
  ensureQuotationPdf,
  isQuotationPdfReady,
  calculateGstTotals,
  type GstMode,
} from "../../services/quotation.service";
import {
  buildQuotationTallyMessage,
  buildTallyImportEnvelope,
} from "../../lib/quotation-tally-xml";
import { getQuotationPdfPublicUrl } from "../../utils/public-url";
import { scheduleInquiryFollowup } from "../../services/automation.service";
import { logActivity } from "../../utils/activity";
import { logger } from "../../utils/logger";
import { normalizePhone, normalizePhoneOrNull } from "../../utils/phone";
import {
  ensureConversationForCustomer,
  findOrCreateCustomerByPhone,
} from "../../services/conversation.service";
import { Prisma } from "@prisma/client";

/** Find or create the WhatsApp inbox conversation for a customer. */
async function ensureCustomerConversation(customerId: string): Promise<string> {
  const conversation = await ensureConversationForCustomer(customerId);
  return conversation.id;
}

function resolveBillCustomer(enquiry: {
  billCustomerName?: string | null;
  billCustomerPhone?: string | null;
  billCustomerCompany?: string | null;
  customer: {
    id: string;
    name: string | null;
    phone: string;
    company?: string | null;
  };
}) {
  return {
    id: enquiry.customer.id,
    name: enquiry.billCustomerName ?? enquiry.customer.name,
    phone: enquiry.billCustomerPhone ?? enquiry.customer.phone,
    company: enquiry.billCustomerCompany ?? enquiry.customer.company ?? null,
  };
}

export async function getQuotation(req: Request, res: Response) {
  const { id } = req.params;

  try {
    const q = await prisma.quotation.findUnique({
      where: { id },
      include: {
        enquiry: {
          include: {
            customer: true,
            items: {
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });

    if (!q) {
      return res.status(404).json({ detail: "Quotation not found" });
    }

    const presignedUrl = await getPresignedUrl(q.s3Key, 3600);
    const pdfReady = await isQuotationPdfReady(q.s3Key);

    const sendHistoryRaw = await prisma.whatsappMessage.findMany({
      where: {
        direction: "OUTBOUND",
        type: { in: ["image", "template", "text", "document"] },
        content: { contains: q.number },
      },
      orderBy: { createdAt: "desc" },
      include: {
        conversation: {
          include: { customer: true },
        },
      },
    });

    const sendHistory = sendHistoryRaw
      .filter((msg) => msg.conversation?.customer)
      .map((msg) => ({
        id: msg.id,
        sentAt: msg.createdAt.toISOString(),
        caption: msg.content || "",
        status: msg.waMessageId ? "sent" : "sending",
        customer: {
          id: msg.conversation.customer.id,
          name: msg.conversation.customer.name,
          phone: msg.conversation.customer.phone,
        },
      }));

    let deliveryStatus: string | null = null;
    if (sendHistory.length > 0) {
      deliveryStatus = sendHistory[0].status;
    } else if (q.sentAt) {
      deliveryStatus = "sent";
    }

    const gstPercent = q.enquiry.gstPercent ?? 18;
    const gstMode = (q.enquiry.gstMode ?? "exclusive") as GstMode;
    const deliveryCharge = q.enquiry.deliveryCharge ?? 0;
    const lineItems = q.enquiry.items.map((item) => ({
      qty: item.qty,
      rate: item.rate || 0,
    }));
    const { subtotal, gstAmount, roundOff, grandTotal } = calculateGstTotals(
      lineItems,
      gstPercent,
      gstMode,
      deliveryCharge
    );
    const billCustomer = resolveBillCustomer(q.enquiry);

    return res.json({
      id: q.id,
      enquiryId: q.enquiryId,
      s3Key: q.s3Key,
      s3Url: q.s3Url,
      number: q.number,
      sentAt: q.sentAt?.toISOString() || sendHistory[0]?.sentAt || null,
      createdAt: q.createdAt.toISOString(),
      presignedUrl,
      pdfReady,
      tallyReady: Boolean(q.tallyS3Key),
      enquiry: q.enquiry,
      customer: billCustomer,
      billCustomer,
      gstMode,
      items: q.enquiry.items,
      subtotal,
      deliveryCharge,
      gstPercent,
      gstAmount,
      roundOff,
      grandTotal,
      deliveryStatus,
      sendHistory,
    });
  } catch (error) {
    logger.error(`Error retrieving quotation ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function regenerateQuotation(req: Request, res: Response) {
  const { id } = req.params;
    const bodyGstPercent = req.body?.gstPercent;
    const gstPercent =
      bodyGstPercent !== undefined && bodyGstPercent !== null
        ? (() => {
            const n = Number(bodyGstPercent);
            return Number.isFinite(n) ? n : undefined;
          })()
        : undefined;
    const gstMode =
      req.body?.gstMode === "inclusive"
        ? "inclusive"
        : req.body?.gstMode === "exclusive"
          ? "exclusive"
          : undefined;
  const {
    billCustomerName,
    billCustomerPhone,
    billCustomerCompany,
    deliveryCharge: bodyDeliveryCharge,
  } = req.body ?? {};

  try {
    const existing = await prisma.quotation.findUnique({
      where: { id },
      select: { enquiryId: true },
    });
    if (!existing) {
      return res.status(404).json({ detail: "Quotation not found" });
    }

    const enquiryUpdate: Record<string, unknown> = {};
    if (gstPercent !== undefined) {
      enquiryUpdate.gstPercent = gstPercent;
    }
    if (gstMode !== undefined) {
      enquiryUpdate.gstMode = gstMode;
    }
    if (bodyDeliveryCharge !== undefined) {
      const parsed = parseFloat(String(bodyDeliveryCharge));
      enquiryUpdate.deliveryCharge = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }
    if (billCustomerName !== undefined) {
      enquiryUpdate.billCustomerName = billCustomerName?.trim() || null;
    }
    if (billCustomerPhone !== undefined) {
      enquiryUpdate.billCustomerPhone = normalizePhoneOrNull(billCustomerPhone);
    }
    if (billCustomerCompany !== undefined) {
      enquiryUpdate.billCustomerCompany = billCustomerCompany?.trim() || null;
    }

    const enquiry = await prisma.enquiry.update({
      where: { id: existing.enquiryId },
      data: enquiryUpdate,
    });

    const quotation = await regenerateQuotationPdf(
      id,
      enquiry.gstPercent ?? 18,
      (enquiry.gstMode ?? "exclusive") as GstMode
    );
    const presignedUrl = await getPresignedUrl(quotation.s3Key, 3600);
    const pdfReady = await isQuotationPdfReady(quotation.s3Key);

    await logActivity(req.user!.id, "regenerate", "quotation", id);

    return res.json({
      ok: true,
      id: quotation.id,
      s3Key: quotation.s3Key,
      pdfReady,
      presignedUrl,
      number: quotation.number,
    });
  } catch (error: any) {
    logger.error(`Error regenerating quotation ${id}: ` + error);
    return res.status(500).json({
      detail: error?.message || "Failed to regenerate quotation PDF",
    });
  }
}

export async function sendQuotation(req: Request, res: Response) {
  const { id } = req.params;
  const {
    customerId,
    newCustomer,
    gstPercent: bodyGst,
    gstMode: bodyGstMode,
    deliveryCharge: bodyDeliveryCharge,
    billCustomerName,
    billCustomerPhone,
    billCustomerCompany,
  } = req.body as {
    customerId?: string;
    newCustomer?: { name: string; phone: string };
    gstPercent?: number;
    gstMode?: string;
    deliveryCharge?: number;
    billCustomerName?: string;
    billCustomerPhone?: string;
    billCustomerCompany?: string;
  };

  try {
    let q = await prisma.quotation.findUnique({
      where: { id },
      include: {
        enquiry: {
          include: { customer: true, items: true },
        },
      },
    });

    if (!q) {
      return res.status(404).json({ detail: "Quotation not found" });
    }

    let targetCustomer = q.enquiry.customer;
    let targetConversationId = q.enquiry.conversationId;
    const originalCustomerId = q.enquiry.customerId;
    const enquiryUpdate: Record<string, unknown> = {};

    if (bodyGst !== undefined && bodyGst !== null) {
      const n = Number(bodyGst);
      enquiryUpdate.gstPercent = Number.isFinite(n) ? n : 18;
    }
    if (bodyGstMode !== undefined) {
      enquiryUpdate.gstMode = bodyGstMode === "inclusive" ? "inclusive" : "exclusive";
    }
    if (bodyDeliveryCharge !== undefined) {
      const parsed = Number(bodyDeliveryCharge);
      enquiryUpdate.deliveryCharge = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }
    if (billCustomerName !== undefined) {
      enquiryUpdate.billCustomerName = billCustomerName?.trim() || null;
    }
    if (billCustomerPhone !== undefined) {
      enquiryUpdate.billCustomerPhone = normalizePhoneOrNull(billCustomerPhone);
    }
    if (billCustomerCompany !== undefined) {
      enquiryUpdate.billCustomerCompany = billCustomerCompany?.trim() || null;
    }

    if (newCustomer?.phone) {
      const phone = normalizePhone(newCustomer.phone.trim());
      targetCustomer = await findOrCreateCustomerByPhone(phone, {
        name: newCustomer.name || null,
      });
      enquiryUpdate.billCustomerName = newCustomer.name?.trim() || targetCustomer.name;
      enquiryUpdate.billCustomerPhone = phone;
      logger.info(`sendQuotation: Created/used customer ${targetCustomer.id} (${phone})`);
    } else if (customerId) {
      const existing = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!existing) {
        return res.status(400).json({ detail: "Customer not found" });
      }
      targetCustomer = existing;
      enquiryUpdate.billCustomerName = existing.name;
      enquiryUpdate.billCustomerPhone = existing.phone;
      logger.info(`sendQuotation: Using existing customer ${targetCustomer.id}`);
    }

    // Always put the outbound quotation in the recipient's inbox (create if needed).
    targetConversationId = await ensureCustomerConversation(targetCustomer.id);
    if (targetCustomer.id !== originalCustomerId) {
      enquiryUpdate.customerId = targetCustomer.id;
      enquiryUpdate.conversationId = targetConversationId;
    }

    if (Object.keys(enquiryUpdate).length > 0) {
      await prisma.enquiry.update({
        where: { id: q.enquiryId },
        data: enquiryUpdate,
      });
      q = await prisma.quotation.findUnique({
        where: { id },
        include: {
          enquiry: {
            include: { customer: true, items: true },
          },
        },
      });
    }

    if (!q) {
      return res.status(404).json({ detail: "Quotation not found" });
    }

    const gstPercent = q.enquiry.gstPercent ?? 18;
    const gstMode = (q.enquiry.gstMode ?? "exclusive") as GstMode;

    try {
      await regenerateQuotationPdf(q.id, gstPercent, gstMode);
      q = await prisma.quotation.findUnique({
        where: { id },
        include: {
          enquiry: {
            include: { customer: true, items: true },
          },
        },
      });
    } catch (error: any) {
      logger.error(`sendQuotation: PDF regeneration failed for ${id}: ${error?.message || error}`);
      return res.status(400).json({
        detail: error?.message || "Failed to regenerate quotation PDF before sending",
      });
    }

    if (!q || !(await isQuotationPdfReady(q.s3Key))) {
      return res.status(400).json({
        detail: "Quotation PDF is not ready. Regenerate the quotation before sending on WhatsApp.",
      });
    }

    if (!targetCustomer) {
      return res.status(400).json({ detail: "Customer missing" });
    }

    const pdfProxyUrl = `${getQuotationPdfPublicUrl(q.id)}?v=${Date.now()}`;
    const lineItems = q.enquiry.items.map((item) => ({
      qty: item.qty,
      rate: item.rate || 0,
    }));
    const deliveryCharge = q.enquiry.deliveryCharge ?? 0;
    const { grandTotal } = calculateGstTotals(lineItems, gstPercent, gstMode, deliveryCharge);

    const caption = `Quotation ${q.number} — Grand Total Rs ${grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const messageId = await sendTemplateMessage(
      targetCustomer.phone,
      "mahabir_quotation_pdf_delivery",
      {
        variables: [q.number],
        documentHeader: {
          url: pdfProxyUrl,
          filename: `${q.number}.pdf`,
        },
      },
      targetConversationId
    );

    const now = new Date();
    await prisma.quotation.update({
      where: { id },
      data: { sentAt: now },
    });

    await prisma.enquiry.update({
      where: { id: q.enquiryId },
      data: { status: "SENT" },
    });

    await prisma.customer.update({
      where: { id: targetCustomer.id },
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
        await scheduleInquiryFollowup(rule.id, targetCustomer.id, days, q.enquiryId, q.number);
      } catch (err: any) {
        logger.warn(
          `sendQuotation: skipped inquiry follow-up for rule ${rule.id}: ${err?.message || err}`
        );
      }
    }

    await logActivity(req.user!.id, "send", "quotation", id);

    return res.json({
      ok: true,
      sentAt: now.toISOString(),
      messageId,
      customerId: targetCustomer.id,
      customer: {
        id: targetCustomer.id,
        name: targetCustomer.name,
        phone: targetCustomer.phone,
      },
      caption,
    });
  } catch (error) {
    logger.error(`Error sending quotation ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

function parseDayStart(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDayEnd(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Bulk Tally XML export: GET /quotations/tally-export?from=&to=&customerId= */
export async function exportQuotationsTally(req: Request, res: Response) {
  const fromStr = String(req.query.from || "");
  const toStr = String(req.query.to || "");
  const customerId = typeof req.query.customerId === "string" ? req.query.customerId.trim() : "";

  const from = parseDayStart(fromStr);
  const to = parseDayEnd(toStr);

  if (!from || !to) {
    return res.status(400).json({ detail: "from and to are required as YYYY-MM-DD" });
  }
  if (from > to) {
    return res.status(400).json({ detail: "from must be on or before to" });
  }

  try {
    const where: Prisma.QuotationWhereInput = {
      createdAt: { gte: from, lte: to },
    };
    if (customerId) {
      where.enquiry = { customerId };
    }

    const quotations = await prisma.quotation.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: {
        enquiry: {
          include: {
            customer: true,
            items: true,
          },
        },
      },
    });

    if (quotations.length === 0) {
      return res.status(404).json({ detail: "No quotations found for the selected filters" });
    }

    const messages = quotations.map((q) => {
      const enquiry = q.enquiry;
      const percent = enquiry.gstPercent ?? 18;
      const mode = (enquiry.gstMode ?? "exclusive") as GstMode;
      const delivery = enquiry.deliveryCharge ?? 0;
      const lineItems = enquiry.items.map((item) => ({
        qty: item.qty,
        rate: item.rate || 0,
      }));
      const totals = calculateGstTotals(lineItems, percent, mode, delivery);
      const billCustomer = resolveBillCustomer(enquiry);

      return buildQuotationTallyMessage({
        quotationNumber: q.number,
        date: q.createdAt,
        customer: billCustomer,
        items: enquiry.items,
        gstPercent: percent,
        gstMode: mode,
        totals,
      });
    });

    const xml = buildTallyImportEnvelope(messages);
    const filename = `quotations-tally-${fromStr}-${toStr}.xml`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    return res.send(xml);
  } catch (error) {
    logger.error("Error exporting quotations for Tally: " + error);
    return res.status(500).json({ detail: "Failed to export quotations" });
  }
}
