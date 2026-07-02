-- pgvector extension (requires pgvector-enabled Postgres image)
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop legacy fake 16-dim float array column
ALTER TABLE "ProductEmbedding" DROP COLUMN IF EXISTS "embedding";

-- Add pgvector column and metadata
ALTER TABLE "ProductEmbedding" ADD COLUMN IF NOT EXISTS "embedding_vec" vector(768);
ALTER TABLE "ProductEmbedding" ADD COLUMN IF NOT EXISTS "model" TEXT NOT NULL DEFAULT 'text-embedding-004';
ALTER TABLE "ProductEmbedding" ADD COLUMN IF NOT EXISTS "model_version" TEXT NOT NULL DEFAULT '1';
ALTER TABLE "ProductEmbedding" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Deduplicate rows before unique constraint
DELETE FROM "ProductEmbedding" a
USING "ProductEmbedding" b
WHERE a.ctid < b.ctid
  AND a."inventoryId" = b."inventoryId"
  AND a.text = b.text;

CREATE UNIQUE INDEX IF NOT EXISTS "ProductEmbedding_inventoryId_text_key"
  ON "ProductEmbedding"("inventoryId", text);

CREATE INDEX IF NOT EXISTS "ProductEmbedding_inventoryId_idx"
  ON "ProductEmbedding"("inventoryId");

-- HNSW index (small catalog settings: m=16, ef_construction=64)
CREATE INDEX IF NOT EXISTS "product_embedding_vec_hnsw_idx"
  ON "ProductEmbedding" USING hnsw (embedding_vec vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
