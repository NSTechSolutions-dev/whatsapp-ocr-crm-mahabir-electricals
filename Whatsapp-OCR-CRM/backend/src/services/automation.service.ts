import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "../utils/logger";
import { OPEN_PIPELINE_STAGES } from "../config/automation-rules";
import {
  enqueueAutomationJob,
  recordCronTick,
} from "./automation-execution.service";

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function customerRepliedSince(customerId: string, since: Date): Promise<boolean> {
  const conv = await prisma.conversation.findFirst({
    where: { customerId },
    include: {
      messages: {
        where: { direction: "INBOUND", createdAt: { gt: since } },
        take: 1,
      },
    },
  });
  return (conv?.messages?.length ?? 0) > 0;
}

async function getLatestEnquiry(customerId: string) {
  return prisma.enquiry.findFirst({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    include: { quotation: true },
  });
}

async function hasRecentExecution(ruleId: string, customerId: string, since: Date): Promise<boolean> {
  const existing = await prisma.scheduledJob.findFirst({
    where: {
      ruleId,
      customerId,
      status: { in: ["COMPLETED", "PENDING", "PROCESSING"] },
      isTest: false,
      createdAt: { gte: since },
    },
  });
  return !!existing;
}

export type TriggerResult = { queued: number; skipped: number };

export async function scheduleInquiryFollowup(
  ruleId: string,
  customerId: string,
  days: number,
  enquiryId: string,
  quotationNumber: string
): Promise<string> {
  const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!rule || !customer) throw new Error("Rule or customer not found");

  const actionParams = rule.actionParams as Record<string, unknown>;
  const templateName = String(actionParams?.templateName || "mahabir_inquiry_followup");

  const scheduledAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const scheduledJob = await prisma.scheduledJob.create({
    data: {
      ruleId,
      customerId,
      scheduledAt,
      status: "PENDING",
      metadata: { enquiryId, quotationNumber, templateName } as Prisma.InputJsonValue,
    },
  });

  const { automationQueue } = await import("../jobs/queues");
  const bullJob = await automationQueue.add(
    "inquiry_followup",
    {
      scheduledJobId: scheduledJob.id,
      ruleId,
      customerId,
      phone: customer.phone,
      templateName,
      variables: [customer.name || "Customer", quotationNumber],
      enquiryId,
      quotationNumber,
    },
    { delay: days * 24 * 60 * 60 * 1000 }
  );

  await prisma.scheduledJob.update({
    where: { id: scheduledJob.id },
    data: { bullJobId: String(bullJob.id) },
  });

  return scheduledJob.id;
}

export async function triggerPriceDrop(inventoryId: string, oldRate: number, newRate: number) {
  if (newRate >= oldRate) return { queued: 0, skipped: 0 };

  let queued = 0;
  let skipped = 0;

  try {
    const rules = await prisma.automationRule.findMany({
      where: { triggerType: "price_drop_alert", isActive: true },
    });
    if (rules.length === 0) return { queued, skipped };

    const items = await prisma.enquiryItem.findMany({
      where: { inventoryId },
      select: { enquiryId: true },
    });
    const enquiryIds = Array.from(new Set(items.map((it) => it.enquiryId)));
    if (enquiryIds.length === 0) return { queued, skipped };

    const enquiries = await prisma.enquiry.findMany({
      where: { id: { in: enquiryIds } },
      select: { customerId: true },
    });
    const customerIds = Array.from(new Set(enquiries.map((e) => e.customerId)));
    const inventory = await prisma.inventory.findUnique({ where: { id: inventoryId } });
    if (!inventory) return { queued, skipped };

    const dropPct = oldRate > 0 ? ((oldRate - newRate) / oldRate) * 100 : 0;

    for (const rule of rules) {
      const triggerParams = rule.triggerParams as Record<string, unknown>;
      const threshold = Number(triggerParams?.threshold ?? 0);
      const maxInquiryAgeDays = Number(triggerParams?.maxInquiryAgeDays ?? 30);
      const maxAgeCutoff = daysAgo(maxInquiryAgeDays);

      if (threshold > 0 && dropPct < threshold) continue;

      const actionParams = rule.actionParams as Record<string, unknown>;
      const templateName = String(actionParams?.templateName || "mahabir_price_drop");

      for (const customerId of customerIds) {
        const customer = await prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer || customer.stage === "Closed") {
          skipped++;
          continue;
        }

        const latestEnquiry = await getLatestEnquiry(customerId);
        if (!latestEnquiry || latestEnquiry.createdAt < maxAgeCutoff) {
          skipped++;
          continue;
        }

        await enqueueAutomationJob("price_drop_alert", {
          ruleId: rule.id,
          customerId,
          phone: customer.phone,
          templateName,
          variables: [
            customer.name || "Customer",
            inventory.name,
            oldRate.toFixed(2),
            newRate.toFixed(2),
          ],
          inventoryId,
          oldRate,
          newRate,
        });
        queued++;
      }
    }
  } catch (error) {
    logger.error(`Failed to trigger price drop automation: ${error}`);
  }

  return { queued, skipped };
}

export async function triggerRepeatEngagement(): Promise<TriggerResult> {
  let queued = 0;
  let skipped = 0;

  try {
    const rules = await prisma.automationRule.findMany({
      where: { triggerType: "repeat_engagement", isActive: true },
    });

    for (const rule of rules) {
      const triggerParams = rule.triggerParams as Record<string, unknown>;
      const inactiveDays = Number(triggerParams?.inactiveDays ?? triggerParams?.days ?? 30);
      const stages = (triggerParams?.stages as string[]) || [...OPEN_PIPELINE_STAGES];
      const cutoff = daysAgo(inactiveDays);

      const actionParams = rule.actionParams as Record<string, unknown>;
      const templateName = String(actionParams?.templateName || "mahabir_repeat_engagement");

      const customers = await prisma.customer.findMany({
        where: { stage: { in: stages } },
      });

      let ruleQueued = 0;
      let ruleSkipped = 0;

      for (const customer of customers) {
        const latestEnquiry = await getLatestEnquiry(customer.id);
        if (!latestEnquiry || latestEnquiry.createdAt > cutoff) {
          ruleSkipped++;
          continue;
        }

        if (await hasRecentExecution(rule.id, customer.id, cutoff)) {
          ruleSkipped++;
          continue;
        }

        await enqueueAutomationJob("repeat_engagement", {
          ruleId: rule.id,
          customerId: customer.id,
          phone: customer.phone,
          templateName,
          variables: [customer.name || "Customer"],
        });
        ruleQueued++;
      }

      queued += ruleQueued;
      skipped += ruleSkipped;

      await recordCronTick({
        ruleId: rule.id,
        queued: ruleQueued,
        skipped: ruleSkipped,
        note:
          ruleQueued === 0
            ? `Daily run: no customers matched (${ruleSkipped} skipped — enquiry too recent or already contacted)`
            : `Daily run: ${ruleQueued} message(s) queued, ${ruleSkipped} skipped`,
      });
    }
  } catch (error) {
    logger.error(`Failed to trigger repeat engagement: ${error}`);
  }

  return { queued, skipped };
}

export async function triggerEnquiryReminder(): Promise<TriggerResult> {
  let queued = 0;
  let skipped = 0;

  try {
    const rules = await prisma.automationRule.findMany({
      where: { triggerType: "enquiry_reminder", isActive: true },
    });

    for (const rule of rules) {
      const triggerParams = rule.triggerParams as Record<string, unknown>;
      const daysSinceSent = Number(triggerParams?.daysSinceSent ?? triggerParams?.hours ?? 7);
      const sentCutoff = daysAgo(daysSinceSent);

      const actionParams = rule.actionParams as Record<string, unknown>;
      const templateName = String(actionParams?.templateName || "mahabir_enquiry_reminder");

      const customers = await prisma.customer.findMany({
        where: { stage: { not: "Closed" } },
      });

      let ruleQueued = 0;
      let ruleSkipped = 0;

      for (const customer of customers) {
        const lastSent = await prisma.enquiry.findFirst({
          where: {
            customerId: customer.id,
            status: "SENT",
            quotation: { is: { sentAt: { not: null } } },
          },
          orderBy: { updatedAt: "desc" },
          include: { quotation: true },
        });

        if (!lastSent?.quotation?.sentAt) {
          ruleSkipped++;
          continue;
        }
        if (lastSent.quotation.sentAt > sentCutoff) {
          ruleSkipped++;
          continue;
        }
        if (await customerRepliedSince(customer.id, lastSent.quotation.sentAt)) {
          ruleSkipped++;
          continue;
        }
        if (await hasRecentExecution(rule.id, customer.id, sentCutoff)) {
          ruleSkipped++;
          continue;
        }

        const quoteRef = lastSent.quotation.number || lastSent.id.slice(0, 8).toUpperCase();

        await enqueueAutomationJob("enquiry_reminder", {
          ruleId: rule.id,
          customerId: customer.id,
          enquiryId: lastSent.id,
          phone: customer.phone,
          templateName,
          variables: [customer.name || "Customer", quoteRef],
        });
        ruleQueued++;
      }

      queued += ruleQueued;
      skipped += ruleSkipped;

      await recordCronTick({
        ruleId: rule.id,
        queued: ruleQueued,
        skipped: ruleSkipped,
        note:
          ruleQueued === 0
            ? `Daily run: no sent quotations need reminder (${ruleSkipped} customers checked)`
            : `Daily run: ${ruleQueued} reminder(s) queued, ${ruleSkipped} skipped`,
      });
    }
  } catch (error) {
    logger.error(`Failed to trigger enquiry reminder: ${error}`);
  }

  return { queued, skipped };
}

export async function runCronRules() {
  const repeat = await triggerRepeatEngagement();
  const reminder = await triggerEnquiryReminder();
  return {
    repeatEngagement: repeat,
    enquiryReminder: reminder,
    totalQueued: repeat.queued + reminder.queued,
    totalSkipped: repeat.skipped + reminder.skipped,
  };
}
