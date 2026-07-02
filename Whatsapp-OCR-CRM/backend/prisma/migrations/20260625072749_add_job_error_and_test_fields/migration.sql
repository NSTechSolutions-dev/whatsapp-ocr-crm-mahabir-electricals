-- AlterTable
ALTER TABLE "ScheduledJob" ADD COLUMN     "errorMsg" TEXT,
ADD COLUMN     "isTest" BOOLEAN NOT NULL DEFAULT false;
