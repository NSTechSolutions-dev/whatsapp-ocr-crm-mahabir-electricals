-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "doNotDisturb" BOOLEAN NOT NULL DEFAULT false;
