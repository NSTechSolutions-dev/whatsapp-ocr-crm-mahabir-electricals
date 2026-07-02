import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { automationQueue } from "../jobs/queues";

export async function touchRuleLastExecuted(ruleId: string) {
  await prisma.automationRule.update({
    where: { id: ruleId },
    data: { lastExecutedAt: new Date() },
  });
}

export async function finishExecution(opts: {
  scheduledJobId?: string;
  ruleId: string;
  customerId: string;
  messageId?: string;
  messageContent?: string;
  metadata?: Record<string, unknown>;
  error?: string;
  isTest?: boolean;
}) {
  const status = opts.error ? "FAILED" : "COMPLETED";
  const data = {
    status: status as "COMPLETED" | "FAILED",
    messageId: opts.messageId,
    messageContent: opts.messageContent,
    errorMsg: opts.error,
    metadata: (opts.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    scheduledAt: new Date(),
    isTest: opts.isTest ?? false,
  };

  if (opts.scheduledJobId) {
    await prisma.scheduledJob.update({
      where: { id: opts.scheduledJobId },
      data,
    });
  } else {
    await prisma.scheduledJob.create({
      data: {
        ruleId: opts.ruleId,
        customerId: opts.customerId,
        ...data,
      },
    });
  }

  if (!opts.error) {
    await touchRuleLastExecuted(opts.ruleId);
  }
}

/** Create a PROCESSING row immediately so the UI shows activity, then enqueue BullMQ job. */
export async function enqueueAutomationJob(
  jobName: string,
  payload: Record<string, unknown> & { ruleId: string; customerId: string }
): Promise<string> {
  const scheduledJob = await prisma.scheduledJob.create({
    data: {
      ruleId: payload.ruleId,
      customerId: payload.customerId,
      scheduledAt: new Date(),
      status: "PROCESSING",
      metadata: { jobName } as Prisma.InputJsonValue,
    },
  });

  const bullJob = await automationQueue.add(
    jobName,
    { ...payload, scheduledJobId: scheduledJob.id },
    { removeOnComplete: 100, removeOnFail: 50 }
  );

  await prisma.scheduledJob.update({
    where: { id: scheduledJob.id },
    data: { bullJobId: String(bullJob.id) },
  });

  return scheduledJob.id;
}

export async function recordSkippedExecution(opts: {
  ruleId: string;
  customerId: string;
  reason: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.scheduledJob.create({
    data: {
      ruleId: opts.ruleId,
      customerId: opts.customerId,
      scheduledAt: new Date(),
      status: "COMPLETED",
      messageContent: `(skipped — ${opts.reason})`,
      metadata: { skipped: true, reason: opts.reason, ...(opts.metadata || {}) } as Prisma.InputJsonValue,
    },
  });
}

export async function recordCronTick(opts: {
  ruleId: string;
  queued: number;
  skipped: number;
  note?: string;
}) {
  const firstCustomer = await prisma.customer.findFirst({ select: { id: true } });
  if (!firstCustomer) {
    await touchRuleLastExecuted(opts.ruleId);
    return;
  }

  await prisma.scheduledJob.create({
    data: {
      ruleId: opts.ruleId,
      customerId: firstCustomer.id,
      scheduledAt: new Date(),
      status: "COMPLETED",
      messageContent: opts.note || `Cron tick: ${opts.queued} queued, ${opts.skipped} skipped`,
      metadata: {
        cronTick: true,
        queued: opts.queued,
        skipped: opts.skipped,
      } as Prisma.InputJsonValue,
    },
  });
  await touchRuleLastExecuted(opts.ruleId);
}
