import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { getPresignedUrl } from "../../lib/s3";
import { sendTemplateMessage } from "../../services/whatsapp.service";
import { getQuotationPdfPublicUrl } from "../../utils/public-url";
import { scheduleInquiryFollowup } from "../../services/automation.service";
import { logActivity } from "../../utils/activity";
import { logger } from "../../utils/logger";

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

    const sendHistoryRaw = await prisma.whatsappMessage.findMany({
      where: {
        direction: "OUTBOUND",
        type: { in: ["image", "template", "text"] },
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

    let subtotal = 0;
    for (const item of q.enquiry.items) {
      subtotal += item.qty * (item.rate || 0);
    }
    const gstPercent = 18.0;
    const gstAmount = subtotal * (gstPercent / 100);
    const grandTotal = subtotal + gstAmount;

    return res.json({
      id: q.id,
      enquiryId: q.enquiryId,
      s3Key: q.s3Key,
      s3Url: q.s3Url,
      number: q.number,
      sentAt: q.sentAt?.toISOString() || sendHistory[0]?.sentAt || null,
      createdAt: q.createdAt.toISOString(),
      presignedUrl,
      enquiry: q.enquiry,
      customer: q.enquiry.customer,
      items: q.enquiry.items,
      subtotal,
      gstPercent,
      gstAmount,
      grandTotal,
      deliveryStatus,
      sendHistory,
    });
  } catch (error) {
    logger.error(`Error retrieving quotation ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function sendQuotation(req: Request, res: Response) {
  const { id } = req.params;
  const { customerId, newCustomer, gstPercent: bodyGst } = req.body as {
    customerId?: string;
    newCustomer?: { name: string; phone: string };
    gstPercent?: number;
  };

  try {
    const q = await prisma.quotation.findUnique({
      where: { id },
      include: {
        enquiry: {
          include: { customer: true },
        },
      },
    });

    if (!q) {
      return res.status(404).json({ detail: "Quotation not found" });
    }

    if (!q.s3Key.toLowerCase().endsWith(".pdf")) {
      return res.status(400).json({
        detail: "Quotation PDF is not ready. Regenerate the quotation before sending on WhatsApp.",
      });
    }

    // Determine target customer
    let targetCustomer = q.enquiry.customer;
    let targetConversationId = q.enquiry.conversationId;

    // Priority 1: Create new customer if newCustomer is provided
    if (newCustomer?.phone) {
      // Normalize phone number
      const phone = newCustomer.phone.trim();

      // Check if customer already exists
      let existing = await prisma.customer.findUnique({ where: { phone } });
      if (existing) {
        // Update name if provided and different
        if (newCustomer.name && existing.name !== newCustomer.name) {
          existing = await prisma.customer.update({
            where: { id: existing.id },
            data: { name: newCustomer.name },
          });
        }
        targetCustomer = existing;
      } else {
        // Create new customer
        targetCustomer = await prisma.customer.create({
          data: {
            phone,
            name: newCustomer.name || null,
          },
        });
      }
      logger.info(`sendQuotation: Created/used new customer ${targetCustomer.id} (${phone})`);
    }
    // Priority 2: Use provided customerId to look up existing customer
    else if (customerId) {
      const existing = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!existing) {
        return res.status(400).json({ detail: "Customer not found" });
      }
      targetCustomer = existing;
      logger.info(`sendQuotation: Using existing customer ${targetCustomer.id}`);
    }

    if (!targetCustomer) {
      return res.status(400).json({ detail: "Customer missing" });
    }

    const pdfProxyUrl = getQuotationPdfPublicUrl(q.id);

    // Calculate Grand Total for template caption in CRM history
    const items = await prisma.enquiryItem.findMany({ where: { enquiryId: q.enquiryId } });
    let subtotal = 0;
    for (const item of items) {
      subtotal += item.qty * (item.rate || 0);
    }
    const gstPercent = Number(bodyGst) || 18;
    const grandTotal = subtotal * (1 + gstPercent / 100);

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

    const rules = await prisma.automationRule.findMany({
      where: {
        triggerType: { in: ["inquiry_followup", "inactivity_followup"] },
        isActive: true,
      },
    });

    for (const rule of rules) {
      const triggerParams = rule.triggerParams as Record<string, unknown>;
      const days = Number(triggerParams?.days ?? 3);
      await scheduleInquiryFollowup(rule.id, targetCustomer.id, days, q.enquiryId, q.number);
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
