-- CreateEnum
CREATE TYPE "LearnedMappingSource" AS ENUM ('FINALIZE', 'MANUAL_EDIT', 'AUTO_CONFIRMED');

-- AlterTable
ALTER TABLE "EnquiryItem" ADD COLUMN "auto_inventory_id" TEXT;

-- CreateTable
CREATE TABLE "LearnedMapping" (
    "id" TEXT NOT NULL,
    "lookup_key" TEXT NOT NULL,
    "lookup_kind" TEXT NOT NULL,
    "inventory_id" TEXT NOT NULL,
    "hit_count" INTEGER NOT NULL DEFAULT 1,
    "source" "LearnedMappingSource" NOT NULL,
    "last_enquiry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnedMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LearnedMapping_lookup_key_lookup_kind_key" ON "LearnedMapping"("lookup_key", "lookup_kind");

-- CreateIndex
CREATE INDEX "LearnedMapping_inventory_id_idx" ON "LearnedMapping"("inventory_id");

-- CreateIndex
CREATE INDEX "LearnedMapping_lookup_key_idx" ON "LearnedMapping"("lookup_key");

-- AddForeignKey
ALTER TABLE "LearnedMapping" ADD CONSTRAINT "LearnedMapping_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
