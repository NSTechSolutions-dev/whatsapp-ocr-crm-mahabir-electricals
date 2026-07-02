-- CreateTable
CREATE TABLE IF NOT EXISTS "InventoryUnitRate" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "InventoryUnitRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProductEmbedding" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[],

    CONSTRAINT "ProductEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryUnitRate_inventoryId_unit_key" ON "InventoryUnitRate"("inventoryId", "unit");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "InventoryUnitRate" ADD CONSTRAINT "InventoryUnitRate_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProductEmbedding" ADD CONSTRAINT "ProductEmbedding_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Backfill unit rates from existing inventory rows
INSERT INTO "InventoryUnitRate" ("id", "inventoryId", "unit", "rate")
SELECT
  'ur_' || i.id,
  i.id,
  COALESCE(NULLIF(TRIM(i.unit), ''), 'Pcs'),
  COALESCE(i."currentRate", 0)
FROM "Inventory" i
WHERE i.unit IS NOT NULL OR i."currentRate" IS NOT NULL
ON CONFLICT ("inventoryId", "unit") DO NOTHING;
