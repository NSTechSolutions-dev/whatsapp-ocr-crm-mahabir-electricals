-- AlterTable
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "hiddenFromPipeline" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CompanySetting" ADD COLUMN IF NOT EXISTS "companyAddress" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "BrandLogo" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "s3Key" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandLogo_pkey" PRIMARY KEY ("id")
);
