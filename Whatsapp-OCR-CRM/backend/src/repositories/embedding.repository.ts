import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";
import { toVectorLiteral } from "../services/embedding.service";

export interface VectorMatchRow {
  inventoryId: string;
  text: string;
  similarity: number;
}

export interface VectorMatchWithInventory extends VectorMatchRow {
  name: string;
  unit: string | null;
  rate: number | null;
}

export async function upsertProductEmbeddings(
  inventoryId: string,
  entries: { text: string; vector: number[] }[]
): Promise<number> {
  if (entries.length === 0) return 0;

  await prisma.productEmbedding.deleteMany({ where: { inventoryId } });

  let saved = 0;
  for (const entry of entries) {
    const id = `pe_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const vecLiteral = toVectorLiteral(entry.vector);
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ProductEmbedding" (id, "inventoryId", text, embedding_vec, model, model_version, created_at)
         VALUES ($1, $2, $3, $4::vector, $5, $6, NOW())`,
        id,
        inventoryId,
        entry.text,
        vecLiteral,
        env.EMBEDDING_MODEL,
        "1"
      );
      saved++;
    } catch (error) {
      logger.error(`Failed to insert embedding for "${entry.text}": ${error}`);
    }
  }

  return saved;
}

export async function findClosestVectorMatchWithInventory(
  queryVector: number[],
  limit: number = 5
): Promise<VectorMatchWithInventory[]> {
  if (!queryVector.length) return [];

  const vecLiteral = toVectorLiteral(queryVector);

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         e."inventoryId" AS "inventoryId",
         e.text AS text,
         1 - (e.embedding_vec <=> $1::vector) AS similarity,
         i.name AS name,
         i.unit AS unit,
         i."currentRate" AS rate
       FROM "ProductEmbedding" e
       JOIN "Inventory" i ON i.id = e."inventoryId"
       WHERE e.embedding_vec IS NOT NULL
       ORDER BY e.embedding_vec <=> $1::vector
       LIMIT $2`,
      vecLiteral,
      limit
    );

    return rows.map((row) => ({
      inventoryId: row.inventoryId as string,
      text: row.text as string,
      similarity: Number(row.similarity ?? 0),
      name: row.name as string,
      unit: (row.unit as string | null) ?? null,
      rate: row.rate != null ? Number(row.rate) : null,
    }));
  } catch (error) {
    logger.error(`Vector search with inventory failed: ${error}`);
    return [];
  }
}

export async function findClosestVectorMatch(
  queryVector: number[],
  limit: number = 3
): Promise<VectorMatchRow[]> {
  if (!queryVector.length) return [];

  const vecLiteral = toVectorLiteral(queryVector);

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         e."inventoryId" AS "inventoryId",
         e.text AS text,
         1 - (e.embedding_vec <=> $1::vector) AS similarity
       FROM "ProductEmbedding" e
       WHERE e.embedding_vec IS NOT NULL
       ORDER BY e.embedding_vec <=> $1::vector
       LIMIT $2`,
      vecLiteral,
      limit
    );

    return rows.map((row) => ({
      inventoryId: row.inventoryId as string,
      text: row.text as string,
      similarity: Number(row.similarity ?? 0),
    }));
  } catch (error) {
    logger.error(`Vector search failed: ${error}`);
    return [];
  }
}

export async function countEmbeddings(): Promise<number> {
  return prisma.productEmbedding.count();
}
