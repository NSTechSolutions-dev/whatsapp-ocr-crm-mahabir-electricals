import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { logger } from "../utils/logger";
import {
  AUTOMATION_RULE_TYPES,
  DEFAULT_AUTOMATION_RULES,
  AutomationRuleType,
} from "../config/automation-rules";

async function dedupeAutomationRules() {
  const all = await prisma.automationRule.findMany({ orderBy: { createdAt: "desc" } });
  const keeperIdByType = new Map<string, string>();

  for (const rule of all) {
    const kept = keeperIdByType.get(rule.triggerType);
    if (kept) {
      await prisma.scheduledJob.updateMany({
        where: { ruleId: rule.id },
        data: { ruleId: kept },
      });
      await prisma.automationRule.delete({ where: { id: rule.id } });
      logger.warn(`Removed duplicate automation rule ${rule.id} (${rule.triggerType})`);
    } else {
      keeperIdByType.set(rule.triggerType, rule.id);
    }
  }
}

async function deleteRulesByTriggerTypes(triggerTypes: string[]) {
  if (triggerTypes.length === 0) return 0;

  const rules = await prisma.automationRule.findMany({
    where: { triggerType: { in: triggerTypes } },
    select: { id: true, triggerType: true },
  });
  if (rules.length === 0) return 0;

  const ruleIds = rules.map((r) => r.id);
  const jobs = await prisma.scheduledJob.deleteMany({
    where: { ruleId: { in: ruleIds } },
  });
  if (jobs.count > 0) {
    logger.info(`Removed ${jobs.count} scheduled job(s) for obsolete rule(s)`);
  }

  const removed = await prisma.automationRule.deleteMany({
    where: { id: { in: ruleIds } },
  });
  for (const rule of rules) {
    logger.info(`Removed obsolete automation rule: ${rule.triggerType} (${rule.id})`);
  }
  return removed.count;
}

async function migrateLegacyRules() {
  await deleteRulesByTriggerTypes(["stage_change"]);

  const legacyInactivity = await prisma.automationRule.findFirst({
    where: { triggerType: "inactivity_followup" },
  });
  if (!legacyInactivity) return;

  const modern = await prisma.automationRule.findFirst({
    where: { triggerType: "inquiry_followup" },
  });

  if (modern) {
    await prisma.scheduledJob.updateMany({
      where: { ruleId: legacyInactivity.id },
      data: { ruleId: modern.id },
    });
    await prisma.automationRule.delete({ where: { id: legacyInactivity.id } });
    logger.info("Merged legacy inactivity_followup rule into inquiry_followup");
  } else {
    await prisma.automationRule.update({
      where: { id: legacyInactivity.id },
      data: {
        triggerType: "inquiry_followup",
        name: "Inquiry Follow-up",
      },
    });
    logger.info("Renamed inactivity_followup → inquiry_followup");
  }
}

async function normalizeRuleDisplayNames() {
  const defaults = new Map(DEFAULT_AUTOMATION_RULES.map((d) => [d.triggerType, d.name]));
  const rules = await prisma.automationRule.findMany({
    where: { triggerType: { in: [...AUTOMATION_RULE_TYPES] } },
  });

  for (const rule of rules) {
    const canonical = defaults.get(rule.triggerType as AutomationRuleType);
    if (!canonical) continue;

    const legacyMarkers = ["Inactivity", "(3 Day", "(24 Hour", "Discount", "Negotiation"];
    const looksLegacy = legacyMarkers.some((m) => rule.name.includes(m));
    if (looksLegacy || rule.name !== canonical) {
      if (looksLegacy) {
        await prisma.automationRule.update({
          where: { id: rule.id },
          data: { name: canonical },
        });
      }
    }
  }
}

export async function ensureAutomationRules() {
  await dedupeAutomationRules();
  await migrateLegacyRules();

  for (const def of DEFAULT_AUTOMATION_RULES) {
    const existing = await prisma.automationRule.findFirst({
      where: { triggerType: def.triggerType },
    });

    if (existing) {
      continue;
    }

    await prisma.automationRule.create({
      data: {
        name: def.name,
        triggerType: def.triggerType,
        triggerParams: def.triggerParams as Prisma.InputJsonValue,
        actionType: def.actionType,
        actionParams: def.actionParams as Prisma.InputJsonValue,
        isActive: def.isActive,
      },
    });
    logger.info(`Created automation rule: ${def.triggerType}`);
  }

  await normalizeRuleDisplayNames();

  const obsoleteTypes = await prisma.automationRule.findMany({
    where: {
      triggerType: { notIn: [...AUTOMATION_RULE_TYPES, "inactivity_followup"] },
    },
    select: { triggerType: true },
  });
  const uniqueObsolete = [...new Set(obsoleteTypes.map((r) => r.triggerType))];
  const removed = await deleteRulesByTriggerTypes(uniqueObsolete);
  if (removed > 0) {
    logger.info(`Removed ${removed} obsolete automation rule(s)`);
  }
}

export async function listAutomationRulesOrdered() {
  await ensureAutomationRules();
  const rules = await prisma.automationRule.findMany({
    where: { triggerType: { in: [...AUTOMATION_RULE_TYPES] } },
  });
  const order = new Map(AUTOMATION_RULE_TYPES.map((t, i) => [t, i]));
  return rules.sort(
    (a, b) =>
      (order.get(a.triggerType as AutomationRuleType) ?? 99) -
      (order.get(b.triggerType as AutomationRuleType) ?? 99)
  );
}
