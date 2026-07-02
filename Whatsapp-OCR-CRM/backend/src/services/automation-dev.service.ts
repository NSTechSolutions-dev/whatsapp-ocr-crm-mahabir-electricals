import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { sendTemplateMessage } from "./whatsapp.service";
import { finishExecution } from "./automation-execution.service";
import { AutomationRuleType } from "../config/automation-rules";
import { logger } from "../utils/logger";

async function resolveTestCustomer(customerId?: string) {
  if (customerId) {
    const c = await prisma.customer.findUnique({ where: { id: customerId } });
    if (c) return c;
  }

  const existing = await prisma.customer.findFirst({ orderBy: { updatedAt: "desc" } });
  if (existing) return existing;

  return prisma.customer.create({
    data: {
      phone: `9198765${String(Date.now()).slice(-4)}`,
      name: "Dev Test Customer",
      stage: "Lead",
    },
  });
}

export async function forceTestAutomationRule(
  triggerType: AutomationRuleType,
  customerId?: string
) {
  const rule = await prisma.automationRule.findFirst({ where: { triggerType } });
  if (!rule) throw new Error(`Rule not found: ${triggerType}`);

  const customer = await resolveTestCustomer(customerId);
  const actionParams = rule.actionParams as Record<string, unknown>;

  const scheduledJob = await prisma.scheduledJob.create({
    data: {
      ruleId: rule.id,
      customerId: customer.id,
      scheduledAt: new Date(),
      status: "PROCESSING",
      isTest: true,
      metadata: { devTest: true, triggerType } as Prisma.InputJsonValue,
    },
  });

  try {
    let messageId: string | undefined;
    let messageContent: string;
    let metadata: Record<string, unknown> = { devTest: true, triggerType };

    switch (triggerType) {
      case "repeat_engagement": {
        const tpl = String(actionParams.templateName || "mahabir_repeat_engagement");
        const vars = [customer.name || "Test Customer"];
        messageId = await sendTemplateMessage(customer.phone, tpl, vars);
        messageContent = `[DEV TEST] ${tpl} | ${vars.join(" | ")}`;
        metadata = { ...metadata, templateName: tpl, variables: vars };
        break;
      }
      case "enquiry_reminder": {
        const tpl = String(actionParams.templateName || "mahabir_enquiry_reminder");
        const vars = [customer.name || "Test Customer", "QT-TEST-00001"];
        messageId = await sendTemplateMessage(customer.phone, tpl, vars);
        messageContent = `[DEV TEST] ${tpl} | ${vars.join(" | ")}`;
        metadata = { ...metadata, templateName: tpl, variables: vars };
        break;
      }
      case "inquiry_followup": {
        const tpl = String(actionParams.templateName || "mahabir_inquiry_followup");
        const vars = [customer.name || "Test Customer", "QT-TEST-00001"];
        messageId = await sendTemplateMessage(customer.phone, tpl, vars);
        messageContent = `[DEV TEST] ${tpl} | ${vars.join(" | ")}`;
        metadata = { ...metadata, templateName: tpl, variables: vars };
        break;
      }
      case "price_drop_alert": {
        const inventory = await prisma.inventory.findFirst({ orderBy: { updatedAt: "desc" } });
        if (!inventory) throw new Error("No inventory items — add a product first");
        const tpl = String(actionParams.templateName || "mahabir_price_drop");
        const vars = [customer.name || "Test", inventory.name, "100.00", "85.00"];
        messageId = await sendTemplateMessage(customer.phone, tpl, vars);
        messageContent = `[DEV TEST] ${tpl} | ${vars.join(" | ")}`;
        metadata = { ...metadata, templateName: tpl, variables: vars, inventoryId: inventory.id };
        break;
      }
      default:
        throw new Error(`Unknown trigger type: ${triggerType}`);
    }

    await finishExecution({
      scheduledJobId: scheduledJob.id,
      ruleId: rule.id,
      customerId: customer.id,
      messageId,
      messageContent,
      metadata,
      isTest: true,
    });

    logger.info(`Dev test OK: ${triggerType} → ${customer.phone}`);
    return {
      ok: true,
      triggerType,
      ruleId: rule.id,
      scheduledJobId: scheduledJob.id,
      customer: { id: customer.id, name: customer.name, phone: customer.phone },
      messageContent,
    };
  } catch (error: any) {
    await finishExecution({
      scheduledJobId: scheduledJob.id,
      ruleId: rule.id,
      customerId: customer.id,
      error: error?.message || String(error),
      isTest: true,
    });
    throw error;
  }
}

export async function forceTestAllAutomationRules(customerId?: string) {
  const types: AutomationRuleType[] = [
    "inquiry_followup",
    "price_drop_alert",
    "repeat_engagement",
    "enquiry_reminder",
  ];

  const results: Array<{ triggerType: string; ok: boolean; error?: string; messageContent?: string }> = [];

  for (const triggerType of types) {
    try {
      const r = await forceTestAutomationRule(triggerType, customerId);
      results.push({ triggerType, ok: true, messageContent: r.messageContent });
    } catch (e: any) {
      results.push({ triggerType, ok: false, error: e?.message || String(e) });
    }
  }

  return { results, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}
