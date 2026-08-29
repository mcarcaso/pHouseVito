import { resolve, join } from "node:path";
import { createEmbeddingDatabase } from "../src/stores/embeddings/embedding-database.js";

const factSetId = process.argv[2];
if (!factSetId)
  throw new Error("Usage: node --import tsx scripts/activate-fact-set.ts <fact-set-id>");

const db = createEmbeddingDatabase(join(resolve(process.cwd()), "user", "embeddings.db"));
try {
  const set = db.prepare("SELECT id, status FROM fact_sets WHERE id = ?").get(factSetId) as
    { id: string; status: string } | undefined;
  if (!set) throw new Error(`Unknown fact set: ${factSetId}`);
  if (set.status !== "ready" && set.status !== "retired" && set.status !== "active")
    throw new Error(`Fact set ${factSetId} is not ready: ${set.status}`);
  const counts = db
    .prepare(
      `SELECT COUNT(*) facts,
              COUNT(e.fact_id) embeddings,
              SUM(CASE WHEN s.fact_id IS NULL THEN 1 ELSE 0 END) facts_without_sources
       FROM facts f
       LEFT JOIN fact_embeddings e ON e.fact_id = f.id
       LEFT JOIN (SELECT DISTINCT fact_id FROM fact_sources) s ON s.fact_id = f.id
       WHERE f.fact_set_id = ?`,
    )
    .get(factSetId) as { facts: number; embeddings: number; facts_without_sources: number };
  if (counts.facts === 0) throw new Error(`Fact set ${factSetId} is empty`);
  if (counts.facts !== counts.embeddings)
    throw new Error(
      `Fact/embedding mismatch for ${factSetId}: ${counts.facts}/${counts.embeddings}`,
    );
  if (counts.facts_without_sources > 0)
    throw new Error(`${counts.facts_without_sources} facts lack evidence sources`);

  db.transaction(() => {
    db.prepare("UPDATE fact_sets SET status = 'retired' WHERE status = 'active' AND id <> ?").run(
      factSetId,
    );
    db.prepare("UPDATE fact_sets SET status = 'active' WHERE id = ?").run(factSetId);
    db.prepare("UPDATE fact_store_state SET active_set_id = ?, updated_at = ? WHERE id = 1").run(
      factSetId,
      Date.now(),
    );
  })();
  console.log(JSON.stringify({ activeFactSet: factSetId, ...counts }, null, 2));
} finally {
  db.close();
}
