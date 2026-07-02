/**
 * Integration tests for pgvector embedding pipeline.
 * Usage: npx ts-node scripts/test-embeddings.ts
 */
import { prisma } from "../src/lib/prisma";
import { setEmbeddingDbReady, embedText, embedQueryCached } from "../src/services/embedding.service";
import { findClosestVectorMatch, countEmbeddings } from "../src/repositories/embedding.repository";
import { runQuotationPipeline } from "../src/services/quotation-pipeline.service";
import { meetsEmbeddingThreshold } from "../src/config/matching";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

async function testPgVectorExtension() {
  console.log("\n1. pgvector extension");
  try {
    await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS vector;");
    setEmbeddingDbReady(true);
    assert(true, "pgvector extension available");
  } catch (error: any) {
    setEmbeddingDbReady(false);
    assert(false, `pgvector extension failed: ${error.message}`);
  }
}

async function testEmbeddingDimensions() {
  console.log("\n2. Gemini embedding dimensions");
  const vector = await embedText("a4 copier paper");
  if (!vector) {
    console.log("  ⚠ Skipping (no GEMINI_API_KEY or embeddings disabled)");
    return;
  }
  assert(vector.length === 768, `vector has 768 dimensions (got ${vector.length})`);
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  assert(norm > 0.9 && norm < 1.1, `vector is normalized (norm=${norm.toFixed(3)})`);
}

async function testVectorSearch() {
  console.log("\n3. Vector search");
  const total = await countEmbeddings();
  if (total === 0) {
    console.log("  ⚠ Skipping (no embeddings — set GEMINI_API_KEY and run npm run reseed)");
    return;
  }
  assert(total > 0, `ProductEmbedding rows exist (${total})`);

  const query = await embedQueryCached("xerox paper a4");
  if (!query) {
    console.log("  ⚠ Skipping vector search (no query embedding)");
    return;
  }

  const matches = await findClosestVectorMatch(query, 3);
  assert(matches.length > 0, "vector search returns results");
  if (matches.length > 0) {
    assert(
      matches[0].similarity > 0.5,
      `top match similarity > 0.5 (${matches[0].similarity.toFixed(3)})`
    );
    console.log(`    top: inventoryId=${matches[0].inventoryId} sim=${matches[0].similarity.toFixed(3)}`);
  }
}

async function testCaseInsensitiveSearch() {
  console.log("\n4. Case-insensitive inventory search");
  const { searchInventory } = await import("../src/services/inventory-search.service");
  const variants = ["BLUE BALL PEN", "blue ball pen", "Blue Ball Pen"];
  const ids = new Set<string>();
  for (const q of variants) {
    const hits = await searchInventory(q);
    assert(hits.length > 0, `"${q}" returns at least one match`);
    if (hits.length > 0) ids.add(hits[0].id);
  }
  assert(ids.size === 1, `all case variants resolve to the same inventory (${ids.size} unique)`);
}

async function testPipelineTrigram() {
  console.log("\n5. Pipeline trigram match (no LLM needed)");
  const result = await runQuotationPipeline("5 ream a4 paper\n10 blue pen");
  assert(result.matchedRows.length >= 2, `matched ${result.matchedRows.length} rows`);
  assert(result.stats.sqlMatches + result.stats.cacheHits >= 1, "at least one trigram/cache hit");
  console.log(`    stats: ${JSON.stringify(result.stats)}`);
}

async function testPipelineVector() {
  console.log("\n5. Pipeline vector match for synonym");
  const embCount = await countEmbeddings();
  if (embCount === 0) {
    console.log("  ⚠ Skipping (no embeddings in DB)");
    return;
  }
  const result = await runQuotationPipeline("3 ream xerox sheet");
  const hit = result.matchedRows.find((r) => r.inventoryId);
  assert(!!hit, "synonym line matched to inventory");
  if (hit) {
    console.log(`    matched: ${hit.matchedName} via ${hit.matchType} score=${hit.matchScore.toFixed(3)}`);
  }
}

async function testThresholdConfig() {
  console.log("\n6. Threshold helpers");
  assert(meetsEmbeddingThreshold(0.82), "0.82 meets default threshold");
  assert(!meetsEmbeddingThreshold(0.5), "0.5 below threshold");
}

async function main() {
  console.log("=== Embedding Integration Tests ===");
  await testPgVectorExtension();
  await testEmbeddingDimensions();
  await testVectorSearch();
  await testPipelineTrigram();
  await testPipelineVector();
  await testThresholdConfig();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  await prisma.$disconnect();

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
