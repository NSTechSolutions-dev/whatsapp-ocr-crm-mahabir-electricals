-- AlterTable
ALTER TABLE "Enquiry" ADD COLUMN "gstPercent" DOUBLE PRECISION NOT NULL DEFAULT 18;
ALTER TABLE "Enquiry" ADD COLUMN "gstMode" TEXT NOT NULL DEFAULT 'exclusive';
ALTER TABLE "Enquiry" ADD COLUMN "billCustomerName" TEXT;
ALTER TABLE "Enquiry" ADD COLUMN "billCustomerPhone" TEXT;
ALTER TABLE "Enquiry" ADD COLUMN "billCustomerCompany" TEXT;

-- CreateTable
CREATE TABLE "CompanySetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "bankName" TEXT,
    "accountName" TEXT,
    "accountNumber" TEXT,
    "ifsc" TEXT,
    "branch" TEXT,
    "upiId" TEXT,
    "qrS3Key" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySetting_pkey" PRIMARY KEY ("id")
);
