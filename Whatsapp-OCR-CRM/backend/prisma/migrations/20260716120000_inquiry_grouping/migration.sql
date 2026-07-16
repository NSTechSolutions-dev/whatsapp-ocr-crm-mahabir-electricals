-- AlterEnum
ALTER TYPE "EnquiryStatus" ADD VALUE IF NOT EXISTS 'WAITING';
ALTER TYPE "EnquiryStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "EnquiryStatus" ADD VALUE IF NOT EXISTS 'FAILED';

-- AlterTable
ALTER TABLE "Enquiry" ADD COLUMN IF NOT EXISTS "processAt" TIMESTAMP(3);
ALTER TABLE "Enquiry" ADD COLUMN IF NOT EXISTS "processingError" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "EnquiryImage" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnquiryImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EnquiryImage_messageId_key" ON "EnquiryImage"("messageId");
CREATE INDEX IF NOT EXISTS "EnquiryImage_enquiryId_idx" ON "EnquiryImage"("enquiryId");
CREATE INDEX IF NOT EXISTS "Enquiry_customerId_status_processAt_idx" ON "Enquiry"("customerId", "status", "processAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "EnquiryImage" ADD CONSTRAINT "EnquiryImage_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "EnquiryImage" ADD CONSTRAINT "EnquiryImage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WhatsappMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
