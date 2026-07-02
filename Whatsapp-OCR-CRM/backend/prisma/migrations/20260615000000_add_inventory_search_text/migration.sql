-- Enable trigram extension (idempotent; also enabled at server startup)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "Inventory" ADD COLUMN IF NOT EXISTS "search_text" TEXT;

-- Backfill search_text from name, unit, and aliases
UPDATE "Inventory"
SET "search_text" = lower(
  trim(
    regexp_replace(
      regexp_replace(
        concat_ws(
          ' ',
          name,
          COALESCE(unit, ''),
          array_to_string(aliases, ' ')
        ),
        '[.,\-_()\/\\]',
        ' ',
        'g'
      ),
      '\s+',
      ' ',
      'g'
    )
  )
)
WHERE "search_text" IS NULL OR "search_text" = '';

CREATE INDEX IF NOT EXISTS "Inventory_search_text_trgm_idx"
  ON "Inventory" USING GIN ("search_text" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Inventory_name_trgm_idx"
  ON "Inventory" USING GIN (lower(name) gin_trgm_ops);