import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { prisma } from "../lib/prisma";
import { sendTemplateMessage } from "../services/whatsapp.service";
import { finishExecution } from "../services/automation-execution.service";
import { isAutomationBlocked } from "../services/automation-guard.service";
import { logger } from "../utils/logger";

async function skipIfBlocked(
  scheduledJobId: string | undefined,
  ruleId: string,
  customerId: string
): Promise<boolean> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    await finishExecution({
      scheduledJobId,
      ruleId,
      customerId,
      error: "Customer missing",
    });
    return true;
  }
  if (isAutomationBlocked(customer)) {
    await finishExecution({
      scheduledJobId,
      ruleId,
      customerId,
      messageContent: "(skipped — Lost or DND)",
      metadata: { skipped: true, reason: "lost_or_dnd" },
    });
    return true;
  }
  return false;
}

export const automationWorker = new Worker(
  "automationQueue",
  async (job) => {
    const {
      scheduledJobId,
      ruleId,
      customerId,
      phone,
      templateName,
      variables,
      enquiryId,
      quotationNumber,
    } = job.data;

    logger.info(`Worker running automation: ${job.name} for customer ${customerId}`);

    try {
      if (await skipIfBlocked(scheduledJobId, ruleId, customerId)) {
        return;
      }

      if (job.name === "inquiry_followup" || job.name === "inactivity_followup") {
        const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
        const customer = await prisma.customer.findUnique({ where: { id: customerId } });
        if (!rule?.isActive || !customer) {
          await finishExecution({
            scheduledJobId,
            ruleId,
            customerId,
            error: "Rule inactive or customer missing",
          });
          return;
        }

        const enquiry = enquiryId
          ? await prisma.enquiry.findUnique({
              where: { id: enquiryId },
              include: { quotation: true },
            })
          : null;

        const sentAt = enquiry?.quotation?.sentAt;
        // Only follow up after the quotation was actually sent to the customer.
        if (!sentAt || enquiry?.status !== "SENT") {
          await finishExecution({
            scheduledJobId,
            ruleId,
            customerId,
            messageContent: "(skipped — quotation not sent)",
            metadata: { skipped: true, reason: "quotation_not_sent" },
          });
          return;
        }

        if (await hasInboundSince(customerId, sentAt)) {
          await finishExecution({
            scheduledJobId,
            ruleId,
            customerId,
            messageContent: "(skipped — customer replied)",
            metadata: { skipped: true, reason: "customer_replied" },
          });
          return;
        }

        const actionParams = rule.actionParams as Record<string, unknown>;
        const tpl = templateName || String(actionParams?.templateName || "mahabir_inquiry_followup");
        const vars = variables || [customer.name || "Customer", quotationNumber || "—"];
        const messageId = await sendTemplateMessage(customer.phone, tpl, vars);
        const content = `${tpl} | ${vars.join(" ")}`;

        await finishExecution({
          scheduledJobId,
          ruleId,
          customerId,
          messageId,
          messageContent: content,
          metadata: { templateName: tpl, variables: vars, enquiryId, quotationNumber },
        });
      } else if (job.name === "price_drop_alert") {
        const messageId = await sendTemplateMessage(phone, templateName, variables);
        const content = `${templateName} | ${(variables || []).join(" ")}`;
        await finishExecution({
          scheduledJobId,
          ruleId,
          customerId,
          messageId,
          messageContent: content,
          metadata: { templateName, variables, inventoryId: job.data.inventoryId },
        });
      } else if (job.name === "repeat_engagement") {
        const messageId = await sendTemplateMessage(phone, templateName, variables);
        const content = `${templateName} | ${(variables || []).join(" ")}`;
        await finishExecution({
          scheduledJobId,
          ruleId,
          customerId,
          messageId,
          messageContent: content,
          metadata: { templateName, variables },
        });
      } else if (job.name === "enquiry_reminder") {
        const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
        const customer = await prisma.customer.findUnique({ where: { id: customerId } });
        if (!rule?.isActive || !customer || customer.stage === "Closed" || isAutomationBlocked(customer)) {
          await finishExecution({
            scheduledJobId,
            ruleId,
            customerId,
            error: "Rule inactive, customer missing, Closed, Lost, or DND",
          });
          return;
        }

        const actionParams = rule.actionParams as Record<string, unknown>;
        const tpl = templateName || String(actionParams?.templateName || "mahabir_enquiry_reminder");
        const vars = variables || [customer.name || "Customer"];
        const messageId = await sendTemplateMessage(customer.phone, tpl, vars);
        const content = `${tpl} | ${vars.join(" ")}`;

        await finishExecution({
          scheduledJobId,
          ruleId,
          customerId,
          messageId,
          messageContent: content,
          metadata: { templateName: tpl, variables: vars, enquiryId },
        });
      } else if (job.name === "closed_review") {
        const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
        const customer = await prisma.customer.findUnique({ where: { id: customerId } });
        if (!rule?.isActive || !customer || isAutomationBlocked(customer)) {
          await finishExecution({
            scheduledJobId,
            ruleId,
            customerId,
            error: "Rule inactive, customer missing, Lost, or DND",
          });
          return;
        }

        const actionParams = rule.actionParams as Record<string, unknown>;
        const tpl = templateName || String(actionParams?.templateName || "google_review");
        const vars = variables || [customer.name || "Customer"];
        const messageId = await sendTemplateMessage(customer.phone, tpl, vars);
        const content = `${tpl} | ${vars.join(" ")}`;

        await finishExecution({
          scheduledJobId,
          ruleId,
          customerId,
          messageId,
          messageContent: content,
          metadata: { templateName: tpl, variables: vars },
        });
      }
    } catch (error: any) {
      logger.error(`Worker failed automation job: ${error}`);
      await finishExecution({
        scheduledJobId,
        ruleId,
        customerId,
        error: error?.message || String(error),
      });
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 5,
  }
);

async function hasInboundSince(customerId: string, since: Date): Promise<boolean> {
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
