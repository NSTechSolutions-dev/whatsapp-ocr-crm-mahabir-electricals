import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { automationQueue } from "../jobs/queues";
import { logger } from "../utils/logger";

export type AutomationCustomerGate = {
  stage: string;
  doNotDisturb: boolean;
};

/** True when automations must not be sent (quotations still allowed). */
export function isAutomationBlocked(customer: AutomationCustomerGate): boolean {
  return customer.doNotDisturb || customer.stage === "Lost";
}

export async function cancelPendingAutomations(
  customerId: string,
  reason: string
): Promise<number> {
  const jobs = await prisma.scheduledJob.findMany({
    where: {
      customerId,
      status: { in: ["PENDING", "PROCESSING"] },
    },
  });

  let cancelled = 0;

  for (const job of jobs) {
    if (job.bullJobId) {
      try {
        const bullJob = await automationQueue.getJob(job.bullJobId);
        if (bullJob) {
          await bullJob.remove();
        }
      } catch (err) {
        logger.warn(
          `Failed to remove BullMQ job ${job.bullJobId} for customer ${customerId}: ${err}`
        );
      }
    }

    const prevMeta =
      job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
        ? (job.metadata as Record<string, unknown>)
        : {};

    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: {
        status: "CANCELLED",
        messageContent: `(cancelled — ${reason})`,
        metadata: {
          ...prevMeta,
          skipped: true,
          reason,
          cancelledAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    cancelled++;
  }

  if (cancelled > 0) {
    logger.info(
      `Cancelled ${cancelled} pending automation job(s) for customer ${customerId} (${reason})`
    );
  }

  return cancelled;
}

/** Move Lost → Lead when the customer sends a new quotation/enquiry request. Does not clear DND. */
export async function reactivateLostCustomer(customerId: string): Promise<boolean> {
  const result = await prisma.customer.updateMany({
    where: { id: customerId, stage: "Lost" },
    data: { stage: "Lead" },
  });
  if (result.count > 0) {
    logger.info(`Reactivated Lost customer ${customerId} → Lead`);
    return true;
  }
  return false;
}
