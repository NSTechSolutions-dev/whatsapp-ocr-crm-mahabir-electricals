import { prisma } from "../lib/prisma";
import { redisConnection } from "../lib/redis";
import { inquiryBatchQueue } from "../jobs/queues";
import { INQUIRY_GROUPING_WINDOW_MS } from "../config/inquiry-grouping";
import { logger } from "../utils/logger";
import { reactivateLostCustomer } from "./automation-guard.service";

const LOCK_TTL_SEC = 5;
const LOCK_PREFIX = "inquiry:group:lock:";

export interface AttachWhatsappImageInput {
  customerId: string;
  conversationId: string;
  messageId: string;
  imageUrl: string;
  createdById: string;
}

export interface AttachWhatsappImageResult {
  enquiryId: string;
  processAt: Date;
  imageCount: number;
  isNewEnquiry: boolean;
  conversationId: string;
}

async function acquireCustomerLock(customerId: string): Promise<boolean> {
  const key = `${LOCK_PREFIX}${customerId}`;
  const result = await redisConnection.set(key, "1", "EX", LOCK_TTL_SEC, "NX");
  return result === "OK";
}

async function releaseCustomerLock(customerId: string): Promise<void> {
  await redisConnection.del(`${LOCK_PREFIX}${customerId}`);
}

async function getSystemAdminUserId(): Promise<string> {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  if (!admin) {
    throw new Error("No active ADMIN user found for enquiry grouping");
  }
  return admin.id;
}

export async function scheduleBatchProcessing(enquiryId: string, processAt: Date): Promise<void> {
  const delay = Math.max(0, processAt.getTime() - Date.now());
  const jobId = `inquiry-batch-${enquiryId}`;

  const existing = await inquiryBatchQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (["delayed", "waiting", "active"].includes(state)) {
      return;
    }
    await existing.remove();
  }

  await inquiryBatchQueue.add(
    "processBatch",
    { enquiryId },
    {
      jobId,
      delay,
      removeOnComplete: true,
      removeOnFail: 50,
    }
  );

  logger.info(`Scheduled inquiry batch job ${jobId} in ${delay}ms`);
}

export async function attachWhatsappImage(
  input: AttachWhatsappImageInput
): Promise<AttachWhatsappImageResult> {
  const { customerId, conversationId, messageId, imageUrl, createdById } = input;

  await reactivateLostCustomer(customerId);

  const existingImage = await prisma.enquiryImage.findUnique({
    where: { messageId },
    include: { enquiry: { include: { _count: { select: { images: true } } } } },
  });
  if (existingImage) {
    return {
      enquiryId: existingImage.enquiryId,
      processAt: existingImage.enquiry.processAt!,
      imageCount: existingImage.enquiry._count.images,
      isNewEnquiry: false,
      conversationId: existingImage.enquiry.conversationId,
    };
  }

  let locked = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    locked = await acquireCustomerLock(customerId);
    if (locked) break;
    await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
  }
  if (!locked) {
    throw new Error(`Could not acquire grouping lock for customer ${customerId}`);
  }

  try {
    const now = new Date();

    return await prisma.$transaction(async (tx) => {
      let enquiry = await tx.enquiry.findFirst({
        where: {
          customerId,
          status: "WAITING",
          processAt: { gt: now },
        },
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { images: true } } },
      });

      let isNewEnquiry = false;

      if (!enquiry) {
        const adminId = createdById || (await getSystemAdminUserId());
        const processAt = new Date(now.getTime() + INQUIRY_GROUPING_WINDOW_MS);

        enquiry = await tx.enquiry.create({
          data: {
            conversationId,
            customerId,
            createdById: adminId,
            status: "WAITING",
            processAt,
          },
          include: { _count: { select: { images: true } } },
        });
        isNewEnquiry = true;
      }

      const pageNumber = enquiry._count.images + 1;

      await tx.enquiryImage.create({
        data: {
          enquiryId: enquiry.id,
          messageId,
          imageUrl,
          pageNumber,
        },
      });

      const imageCount = pageNumber;

      return {
        enquiryId: enquiry.id,
        processAt: enquiry.processAt!,
        imageCount,
        isNewEnquiry,
        conversationId: enquiry.conversationId,
      };
    }).then(async (result) => {
      if (result.isNewEnquiry) {
        await scheduleBatchProcessing(result.enquiryId, result.processAt);
      }
      return result;
    });
  } finally {
    await releaseCustomerLock(customerId);
  }
}

/** Atomically claim a WAITING enquiry whose timer has expired. */
export async function claimWaitingEnquiry(enquiryId: string): Promise<boolean> {
  const result = await prisma.enquiry.updateMany({
    where: {
      id: enquiryId,
      status: "WAITING",
      processAt: { lte: new Date() },
    },
    data: {
      status: "PROCESSING",
      processingError: null,
    },
  });
  return result.count > 0;
}

export async function markEnquiryFailed(enquiryId: string, error: string): Promise<void> {
  await prisma.enquiry.update({
    where: { id: enquiryId },
    data: {
      status: "FAILED",
      processingError: error.slice(0, 2000),
    },
  });
}

export async function findExpiredWaitingEnquiries(limit = 20): Promise<string[]> {
  const rows = await prisma.enquiry.findMany({
    where: {
      status: "WAITING",
      processAt: { lte: new Date() },
    },
    select: { id: true },
    orderBy: { processAt: "asc" },
    take: limit,
  });
  return rows.map((r) => r.id);
}

export async function enqueueExpiredWaitingEnquiries(): Promise<number> {
  const ids = await findExpiredWaitingEnquiries();
  let enqueued = 0;

  for (const enquiryId of ids) {
    const jobId = `inquiry-batch-${enquiryId}`;
    const existing = await inquiryBatchQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (["delayed", "waiting", "active"].includes(state)) {
        continue;
      }
    }

    await inquiryBatchQueue.add(
      "processBatch",
      { enquiryId },
      {
        jobId,
        removeOnComplete: true,
        removeOnFail: 50,
      }
    );
    enqueued++;
  }

  return enqueued;
}

export async function retryFailedBatch(enquiryId: string): Promise<void> {
  const enquiry = await prisma.enquiry.findUnique({
    where: { id: enquiryId },
    include: { _count: { select: { images: true } } },
  });

  if (!enquiry) {
    throw new Error("Enquiry not found");
  }
  if (enquiry.status !== "FAILED" && enquiry.status !== "WAITING") {
    throw new Error("Only FAILED or WAITING enquiries can be retried");
  }
  if (enquiry._count.images === 0) {
    throw new Error("Enquiry has no images to process");
  }

  await prisma.enquiry.update({
    where: { id: enquiryId },
    data: { status: "PROCESSING", processingError: null },
  });

  const jobId = `inquiry-batch-${enquiryId}`;
  await inquiryBatchQueue.add(
    "processBatch",
    { enquiryId },
    {
      jobId,
      removeOnComplete: true,
      removeOnFail: 50,
    }
  );
}
