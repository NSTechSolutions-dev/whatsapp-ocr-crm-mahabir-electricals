-- DropIndex
DROP INDEX "Inventory_search_text_trgm_idx";

-- CreateTable
CREATE TABLE "InventoryUnitRate" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "InventoryUnitRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductEmbedding" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[],

    CONSTRAINT "ProductEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryUnitRate_inventoryId_unit_key" ON "InventoryUnitRate"("inventoryId", "unit");

-- AddForeignKey
ALTER TABLE "InventoryUnitRate" ADD CONSTRAINT "InventoryUnitRate_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEmbedding" ADD CONSTRAINT "ProductEmbedding_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
