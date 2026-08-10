import { prisma } from "../lib/prisma";
import { normalizePhone } from "../utils/phone";
import { logger } from "../utils/logger";

/** All historical phone spellings we might have stored for the same Indian mobile. */
export function phoneLookupCandidates(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  const normalized = normalizePhone(phone);
  const out = new Set<string>();

  if (digits) out.add(digits);
  if (normalized) out.add(normalized);

  if (normalized.length === 10) {
    out.add(`91${normalized}`);
    out.add(`0${normalized}`);
  }

  return [...out];
}

export async function findOrCreateCustomerByPhone(
  phone: string,
  extras?: { name?: string | null; company?: string | null }
) {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    throw new Error("Phone number is required");
  }

  const candidates = phoneLookupCandidates(phone);
  const matches = await prisma.customer.findMany({
    where: { phone: { in: candidates } },
    orderBy: { createdAt: "asc" },
  });

  let customer =
    matches.find((c) => c.phone === normalized) || matches[0] || null;

  if (matches.length > 1 && customer) {
    const others = matches.filter((c) => c.id !== customer!.id);
    await mergeCustomersInto(customer.id, others.map((c) => c.id));
    customer = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
  }

  if (customer && customer.phone !== normalized) {
    try {
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: { phone: normalized },
      });
    } catch (error) {
      logger.warn(
        `Could not canonicalize phone for customer ${customer.id} → ${normalized}: ${error}`
      );
    }
  }

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        phone: normalized,
        name: extras?.name?.trim() || null,
        company: extras?.company?.trim() || null,
      },
    });
    return customer;
  }

  const updates: { name?: string; company?: string } = {};
  if (extras?.name?.trim() && !customer.name) updates.name = extras.name.trim();
  if (extras?.company?.trim() && extras.company.trim() !== (customer.company || "")) {
    updates.company = extras.company.trim();
  }
  if (Object.keys(updates).length) {
    customer = await prisma.customer.update({
      where: { id: customer.id },
      data: updates,
    });
  }

  return customer;
}

/**
 * Ensure exactly one inbox conversation for a customer.
 * Merges any duplicate conversations (e.g. WhatsApp inbound vs forward/automation).
 */
export async function ensureConversationForCustomer(customerId: string) {
  const conversations = await prisma.conversation.findMany({
    where: { customerId },
    orderBy: { lastMessageAt: "desc" },
  });

  const canonicalWaId = `wa-${customerId}`;
  let primary =
    conversations.find((c) => c.waConversationId === canonicalWaId) ||
    conversations[0] ||
    null;

  if (!primary) {
    try {
      return await prisma.conversation.create({
        data: {
          customerId,
          waConversationId: canonicalWaId,
          status: "open",
        },
      });
    } catch (error) {
      // Race: another request created it
      const existing = await prisma.conversation.findUnique({
        where: { waConversationId: canonicalWaId },
      });
      if (existing) return existing;
      const fallback = await prisma.conversation.findFirst({
        where: { customerId },
        orderBy: { lastMessageAt: "desc" },
      });
      if (fallback) return fallback;
      throw error;
    }
  }

  const orphans = conversations.filter((c) => c.id !== primary!.id);
  if (orphans.length > 0) {
    await mergeConversationsInto(
      primary.id,
      orphans.map((c) => c.id)
    );
    logger.info(
      `Merged ${orphans.length} duplicate conversation(s) into ${primary.id} for customer ${customerId}`
    );
  }

  if (primary.waConversationId !== canonicalWaId) {
    const taken = await prisma.conversation.findUnique({
      where: { waConversationId: canonicalWaId },
    });
    if (!taken) {
      primary = await prisma.conversation.update({
        where: { id: primary.id },
        data: { waConversationId: canonicalWaId },
      });
    }
  }

  return primary;
}

/** Resolve the single inbox for a phone (find/create customer + conversation). */
export async function ensureInboxForPhone(
  phone: string,
  extras?: { name?: string | null; company?: string | null }
) {
  const customer = await findOrCreateCustomerByPhone(phone, extras);
  const conversation = await ensureConversationForCustomer(customer.id);
  return { customer, conversation };
}

async function mergeConversationsInto(primaryId: string, orphanIds: string[]) {
  for (const orphanId of orphanIds) {
    await prisma.$transaction(async (tx) => {
      await tx.whatsappMessage.updateMany({
        where: { conversationId: orphanId },
        data: { conversationId: primaryId },
      });
      await tx.enquiry.updateMany({
        where: { conversationId: orphanId },
        data: { conversationId: primaryId },
      });

      const orphan = await tx.conversation.findUnique({ where: { id: orphanId } });
      if (orphan) {
        const primary = await tx.conversation.findUnique({ where: { id: primaryId } });
        if (
          primary &&
          orphan.lastMessageAt > primary.lastMessageAt
        ) {
          await tx.conversation.update({
            where: { id: primaryId },
            data: { lastMessageAt: orphan.lastMessageAt },
          });
        }
        await tx.conversation.delete({ where: { id: orphanId } });
      }
    });
  }
}

async function mergeCustomersInto(primaryId: string, orphanIds: string[]) {
  for (const orphanId of orphanIds) {
    await prisma.$transaction(async (tx) => {
      await tx.conversation.updateMany({
        where: { customerId: orphanId },
        data: { customerId: primaryId },
      });
      await tx.enquiry.updateMany({
        where: { customerId: orphanId },
        data: { customerId: primaryId },
      });
      await tx.scheduledJob.updateMany({
        where: { customerId: orphanId },
        data: { customerId: primaryId },
      });

      const orphan = await tx.customer.findUnique({ where: { id: orphanId } });
      const primary = await tx.customer.findUnique({ where: { id: primaryId } });
      if (orphan && primary) {
        const data: {
          name?: string;
          company?: string;
          stage?: string;
          doNotDisturb?: boolean;
        } = {};
        if (!primary.name && orphan.name) data.name = orphan.name;
        if (!primary.company && orphan.company) data.company = orphan.company;
        // Keep Closed if either is Closed; else keep primary stage
        if (orphan.stage === "Closed" && primary.stage !== "Closed") {
          data.stage = "Closed";
        }
        // DND is sticky: if either record had DND, keep it on after merge
        if (orphan.doNotDisturb && !primary.doNotDisturb) {
          data.doNotDisturb = true;
        }
        if (Object.keys(data).length) {
          await tx.customer.update({ where: { id: primaryId }, data });
        }
        await tx.customer.delete({ where: { id: orphanId } });
      }
    });
    logger.info(`Merged duplicate customer ${orphanId} into ${primaryId}`);
  }

  // After customer merge, collapse conversations for the primary
  await ensureConversationForCustomer(primaryId);
}
