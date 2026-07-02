import cron, { ScheduledTask } from "node-cron";
import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";
import { isCronRuleType } from "../config/automation-rules";
import { triggerRepeatEngagement, triggerEnquiryReminder } from "../services/automation.service";

const activeTasks = new Map<string, ScheduledTask>();

function parseScheduleTime(raw: unknown): { hour: number; minute: number } {
  const str = String(raw || "09:00");
  const [h, m] = str.split(":").map((v) => parseInt(v, 10));
  return {
    hour: Number.isFinite(h) ? h : 9,
    minute: Number.isFinite(m) ? m : 0,
  };
}

async function runCronRule(triggerType: string) {
  if (triggerType === "repeat_engagement") {
    await triggerRepeatEngagement();
  } else if (triggerType === "enquiry_reminder") {
    await triggerEnquiryReminder();
  }
}

function scheduleRule(rule: { id: string; triggerType: string; triggerParams: unknown; isActive: boolean }) {
  const existing = activeTasks.get(rule.id);
  if (existing) {
    existing.stop();
    activeTasks.delete(rule.id);
  }

  if (!rule.isActive || !isCronRuleType(rule.triggerType)) return;

  const params = rule.triggerParams as Record<string, unknown>;
  const { hour, minute } = parseScheduleTime(params.scheduleTime);
  const expression = `${minute} ${hour} * * *`;

  const task = cron.schedule(
    expression,
    async () => {
      try {
        const fresh = await prisma.automationRule.findUnique({ where: { id: rule.id } });
        if (!fresh?.isActive) return;
        logger.info(`Cron tick: ${fresh.triggerType} (${expression} IST)`);
        await runCronRule(fresh.triggerType);
      } catch (err) {
        logger.error(`Cron rule ${rule.triggerType} failed: ${err}`);
      }
    },
    { timezone: "Asia/Kolkata" }
  );

  activeTasks.set(rule.id, task);
  logger.info(`Scheduled cron for ${rule.triggerType} at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} IST`);
}

export async function initAutomationCron() {
  const rules = await prisma.automationRule.findMany({
    where: { triggerType: { in: ["repeat_engagement", "enquiry_reminder"] } },
  });

  for (const rule of rules) {
    scheduleRule(rule);
  }
}

export async function resyncAutomationCron(ruleId?: string) {
  if (ruleId) {
    const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
    if (rule) scheduleRule(rule);
    return;
  }
  await initAutomationCron();
}

export function stopAllAutomationCron() {
  for (const task of activeTasks.values()) {
    task.stop();
  }
  activeTasks.clear();
}
