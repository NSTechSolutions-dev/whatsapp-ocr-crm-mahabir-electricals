-- AutomationRule: lastExecutedAt + unique triggerType
ALTER TABLE "AutomationRule" ADD COLUMN IF NOT EXISTS "lastExecutedAt" TIMESTAMP(3);

-- Deduplicate rules by triggerType (keep newest)
DELETE FROM "AutomationRule" a
USING "AutomationRule" b
WHERE a."triggerType" = b."triggerType" AND a."createdAt" < b."createdAt";

CREATE UNIQUE INDEX IF NOT EXISTS "AutomationRule_triggerType_key" ON "AutomationRule"("triggerType");

-- ScheduledJob tracking fields
ALTER TABLE "ScheduledJob" ADD COLUMN IF NOT EXISTS "messageId" TEXT;
ALTER TABLE "ScheduledJob" ADD COLUMN IF NOT EXISTS "messageContent" TEXT;
ALTER TABLE "ScheduledJob" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
ALTER TABLE "ScheduledJob" ADD COLUMN IF NOT EXISTS "errorMsg" TEXT;
ALTER TABLE "ScheduledJob" ADD COLUMN IF NOT EXISTS "isTest" BOOLEAN NOT NULL DEFAULT false;
