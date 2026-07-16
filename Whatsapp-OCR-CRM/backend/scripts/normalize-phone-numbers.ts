/**
 * One-time migration: normalize Customer.phone to 10-digit Indian format and merge duplicates.
 *
 * Usage:
 *   npx ts-node scripts/normalize-phone-numbers.ts
 *   npx ts-node scripts/normalize-phone-numbers.ts --dry-run
 */
import { PrismaClient } from "@prisma/client";
import { normalizePhone } from "../src/utils/phone";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

type CustomerRow = {
  id: string;
  phone: string;
  name: string | null;
  company: string | null;
  stage: string;
  createdAt: Date;
  _count: {
    conversations: number;
    enquiries: number;
    scheduledJobs: number;
  };
};

async function loadCustomers(): Promise<CustomerRow[]> {
  return prisma.customer.findMany({
    include: {
      _count: {
        select: {
          conversations: true,
          enquiries: true,
          scheduledJobs: true,
        },
      },
    },
  });
}

function scoreCustomer(c: CustomerRow): number {
  return c._count.conversations + c._count.enquiries + c._count.scheduledJobs;
}

function pickSurvivor(group: CustomerRow[]): CustomerRow {
  return [...group].sort((a, b) => {
    const scoreDiff = scoreCustomer(b) - scoreCustomer(a);
    if (scoreDiff !== 0) return scoreDiff;
    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0];
}

function mergeFields(survivor: CustomerRow, duplicate: CustomerRow) {
  return {
    name: survivor.name || duplicate.name,
    company: survivor.company || duplicate.company,
    stage: survivor.stage !== "Lead" ? survivor.stage : duplicate.stage,
  };
}

async function mergeDuplicateIntoSurvivor(survivor: CustomerRow, duplicate: CustomerRow) {
  const canonical = normalizePhone(survivor.phone) || normalizePhone(duplicate.phone);
  if (!canonical) {
    console.warn(`SKIP merge ${survivor.id} + ${duplicate.id}: could not normalize phone`);
    return;
  }

  console.log(
    `MERGE phone=${canonical}: survivor=${survivor.id} (${survivor.phone}) <- duplicate=${duplicate.id} (${duplicate.phone})`
  );

  if (dryRun) return;

  await prisma.$transaction(async (tx) => {
    await tx.conversation.updateMany({
      where: { customerId: duplicate.id },
      data: { customerId: survivor.id },
    });
    await tx.enquiry.updateMany({
      where: { customerId: duplicate.id },
      data: { customerId: survivor.id },
    });
    await tx.scheduledJob.updateMany({
      where: { customerId: duplicate.id },
      data: { customerId: survivor.id },
    });

    const fields = mergeFields(survivor, duplicate);
    await tx.customer.update({
      where: { id: survivor.id },
      data: {
        phone: canonical,
        ...fields,
      },
    });

    await tx.customer.delete({ where: { id: duplicate.id } });
  });
}

async function normalizeSingleton(customer: CustomerRow) {
  const canonical = normalizePhone(customer.phone);
  if (!canonical || canonical === customer.phone) return;

  console.log(`UPDATE phone ${customer.id}: ${customer.phone} -> ${canonical}`);
  if (dryRun) return;

  await prisma.customer.update({
    where: { id: customer.id },
    data: { phone: canonical },
  });
}

async function main() {
  console.log(dryRun ? "DRY RUN — no writes" : "LIVE — applying changes");

  const customers = await loadCustomers();
  const buckets = new Map<string, CustomerRow[]>();

  for (const c of customers) {
    const key = normalizePhone(c.phone) || `raw:${c.phone}`;
    const list = buckets.get(key) || [];
    list.push(c);
    buckets.set(key, list);
  }

  let merged = 0;
  let updated = 0;
  let skipped = 0;

  for (const [key, group] of buckets) {
    if (key.startsWith("raw:")) {
      console.warn(`SKIP bucket ${key}: non-normalizable phones`);
      skipped += group.length;
      continue;
    }

    if (group.length === 1) {
      await normalizeSingleton(group[0]);
      if (normalizePhone(group[0].phone) !== group[0].phone) updated++;
      continue;
    }

    const survivor = pickSurvivor(group);
    const duplicates = group.filter((c) => c.id !== survivor.id);

    for (const dup of duplicates) {
      try {
        await mergeDuplicateIntoSurvivor(survivor, dup);
        merged++;
      } catch (err) {
        console.error(`FAILED merge ${survivor.id} + ${dup.id}:`, err);
        skipped++;
      }
    }

    if (!dryRun) {
      await prisma.customer.update({
        where: { id: survivor.id },
        data: { phone: key },
      });
    }
    updated++;
  }

  console.log(`Done. merged=${merged} updated=${updated} skipped=${skipped} buckets=${buckets.size}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
