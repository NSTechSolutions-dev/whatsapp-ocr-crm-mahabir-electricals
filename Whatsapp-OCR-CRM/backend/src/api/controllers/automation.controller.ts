import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { runCronRules } from "../../services/automation.service";
import { listAutomationRulesOrdered } from "../../services/automation-rules.bootstrap";
import { resyncAutomationCron } from "../../jobs/automation-cron";
import { DEFAULT_AUTOMATION_RULES, AutomationRuleType, AUTOMATION_RULE_TYPES } from "../../config/automation-rules";
import {
  forceTestAutomationRule,
  forceTestAllAutomationRules,
} from "../../services/automation-dev.service";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
export async function getAutomationMeta(req: Request, res: Response) {
  return res.json({
    isDev: env.NODE_ENV === "development",
    ruleTypes: AUTOMATION_RULE_TYPES,
  });
}

export async function devTestRule(req: Request, res: Response) {
  if (env.NODE_ENV !== "development") {
    return res.status(403).json({ detail: "Dev tests only available in development" });
  }

  const { triggerType } = req.params;
  const { customerId } = req.body || {};

  if (!AUTOMATION_RULE_TYPES.includes(triggerType as AutomationRuleType)) {
    return res.status(400).json({ detail: "Invalid trigger type" });
  }

  try {
    const result = await forceTestAutomationRule(triggerType as AutomationRuleType, customerId);
    return res.json(result);
  } catch (error: any) {
    logger.error(`Dev test failed for ${triggerType}: ${error}`);
    return res.status(500).json({ detail: error?.message || "Test failed" });
  }
}

export async function devTestAllRules(req: Request, res: Response) {
  if (env.NODE_ENV !== "development") {
    return res.status(403).json({ detail: "Dev tests only available in development" });
  }

  const { customerId } = req.body || {};

  try {
    const result = await forceTestAllAutomationRules(customerId);
    return res.json(result);
  } catch (error: any) {
    logger.error(`Dev test-all failed: ${error}`);
    return res.status(500).json({ detail: error?.message || "Test failed" });
  }
}

export async function listRules(req: Request, res: Response) {
  try {
    const rules = await listAutomationRulesOrdered();
    const defs = new Map(DEFAULT_AUTOMATION_RULES.map((d) => [d.triggerType, d]));
    const items = rules.map((r) => ({
      ...r,
      description: defs.get(r.triggerType as any)?.description || "",
    }));
    return res.json({ items });
  } catch (error) {
    logger.error("Error listing rules: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function getRule(req: Request, res: Response) {
  const { id } = req.params;
  try {
    const rule = await prisma.automationRule.findUnique({ where: { id } });
    if (!rule) return res.status(404).json({ detail: "Rule not found" });
    const def = DEFAULT_AUTOMATION_RULES.find((d) => d.triggerType === rule.triggerType);
    return res.json({ ...rule, description: def?.description || "" });
  } catch (error) {
    logger.error(`Error getting rule ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function createRule(req: Request, res: Response) {
  return res.status(400).json({
    detail: "Use the fixed rule types. Rules are bootstrapped automatically; update via PUT /rules/:id",
  });
}

export async function updateRule(req: Request, res: Response) {
  const { id } = req.params;
  const { name, triggerParams, actionType, actionParams, isActive } = req.body;

  try {
    const existing = await prisma.automationRule.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ detail: "Rule not found" });

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (triggerParams !== undefined) data.triggerParams = triggerParams;
    if (actionType !== undefined) data.actionType = actionType;
    if (actionParams !== undefined) data.actionParams = actionParams;
    if (isActive !== undefined) data.isActive = isActive;

    const updated = await prisma.automationRule.update({ where: { id }, data });
    await resyncAutomationCron(id);
    return res.json(updated);
  } catch (error) {
    logger.error(`Error updating rule ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function deleteRule(req: Request, res: Response) {
  return res.status(400).json({ detail: "Fixed rules cannot be deleted. Toggle isActive instead." });
}

export async function getRuleStats(req: Request, res: Response) {
  const { id } = req.params;
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [total, completed, failed, last7] = await Promise.all([
      prisma.scheduledJob.count({ where: { ruleId: id } }),
      prisma.scheduledJob.count({ where: { ruleId: id, status: "COMPLETED" } }),
      prisma.scheduledJob.count({ where: { ruleId: id, status: "FAILED" } }),
      prisma.scheduledJob.count({
        where: { ruleId: id, createdAt: { gte: sevenDaysAgo } },
      }),
    ]);

    const rule = await prisma.automationRule.findUnique({
      where: { id },
      select: { lastExecutedAt: true },
    });

    return res.json({ total, completed, failed, last7Days: last7, lastExecutedAt: rule?.lastExecutedAt });
  } catch (error) {
    logger.error(`Error getting rule stats ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function getRuleExecutions(req: Request, res: Response) {
  const { id } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;

  try {
    const [items, total] = await Promise.all([
      prisma.scheduledJob.findMany({
        where: { ruleId: id },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          customer: { select: { id: true, name: true, phone: true, stage: true } },
        },
      }),
      prisma.scheduledJob.count({ where: { ruleId: id } }),
    ]);
    return res.json({ items, total, limit, offset });
  } catch (error) {
    logger.error(`Error listing executions for ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function getRuleConversations(req: Request, res: Response) {
  const { id } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

  try {
    const jobs = await prisma.scheduledJob.findMany({
      where: {
        ruleId: id,
        status: "COMPLETED",
        messageContent: { not: null },
        NOT: {
          messageContent: { startsWith: "(skipped" },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        customer: { select: { id: true, name: true, phone: true, stage: true } },
      },
    });

    const items = jobs.map((j) => ({
      id: j.id,
      customer: j.customer,
      message: j.messageContent,
      messageId: j.messageId,
      sentAt: j.scheduledAt,
      metadata: j.metadata,
    }));

    return res.json({ items });
  } catch (error) {
    logger.error(`Error listing conversations for ${id}: ` + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function listScheduledJobs(req: Request, res: Response) {
  const limit = parseInt(req.query.limit as string) || 100;

  try {
    const jobs = await prisma.scheduledJob.findMany({
      orderBy: { scheduledAt: "desc" },
      take: limit,
      include: { rule: true, customer: true },
    });

    return res.json({ items: jobs });
  } catch (error) {
    logger.error("Error listing scheduled jobs: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}

export async function runNow(req: Request, res: Response) {
  try {
    const summary = await runCronRules();
    // Brief pause so BullMQ worker can finish PROCESSING rows
    await new Promise((r) => setTimeout(r, 1500));
    return res.json({ ok: true, ...summary });
  } catch (error) {
    logger.error("Error manually running automations: " + error);
    return res.status(500).json({ detail: "Internal server error" });
  }
}