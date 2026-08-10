-- AlterTable
ALTER TABLE "WhatsappMessage" ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE "WhatsappMessage" ADD COLUMN IF NOT EXISTS "msg91RequestId" TEXT;
ALTER TABLE "WhatsappMessage" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;
ALTER TABLE "WhatsappMessage" ADD COLUMN IF NOT EXISTS "templateName" TEXT;
ALTER TABLE "WhatsappMessage" ADD COLUMN IF NOT EXISTS "statusUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsappMessage_direction_createdAt_idx" ON "WhatsappMessage"("direction", "createdAt");
CREATE INDEX IF NOT EXISTS "WhatsappMessage_deliveryStatus_createdAt_idx" ON "WhatsappMessage"("deliveryStatus", "createdAt");
CREATE INDEX IF NOT EXISTS "WhatsappMessage_waMessageId_idx" ON "WhatsappMessage"("waMessageId");
CREATE INDEX IF NOT EXISTS "WhatsappMessage_msg91RequestId_idx" ON "WhatsappMessage"("msg91RequestId");

-- Backfill: outbound rows that already have a provider id are at least submitted
UPDATE "WhatsappMessage"
SET "deliveryStatus" = 'submitted',
    "statusUpdatedAt" = COALESCE("statusUpdatedAt", "createdAt")
WHERE "direction" = 'OUTBOUND'
  AND "waMessageId" IS NOT NULL
  AND ("deliveryStatus" = 'queued' OR "deliveryStatus" IS NULL);
