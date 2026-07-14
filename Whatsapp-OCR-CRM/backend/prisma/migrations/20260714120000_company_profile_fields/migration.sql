-- AlterTable
ALTER TABLE "CompanySetting" ADD COLUMN IF NOT EXISTS "companyName" TEXT;
ALTER TABLE "CompanySetting" ADD COLUMN IF NOT EXISTS "companyPhone" TEXT;
ALTER TABLE "CompanySetting" ADD COLUMN IF NOT EXISTS "companyGstin" TEXT;
