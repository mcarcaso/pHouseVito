import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { z } from "zod";
import { RootContext } from "../../src/context/RootContext.js";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";
import { createDatabase } from "../../src/db/schema.js";
import { xEmbeddingDb, xEmbeddingStore, xSessionStore } from "../../src/lib/x.js";
import { MemoryRouterService } from "../../src/routers/memory/memory-router.js";

const userDir = mkdtempSync(join(tmpdir(), "vito-memory-router-"));
writeFileSync(join(userDir, "profile.md"), "# Test Profile\n");
const db = createDatabase(":memory:");
const x = dashboardRouterContext({}, RootContext({ db, userDir, skillsDir: join(userDir, "skills") }));
const sessionStore = xSessionStore(x);
sessionStore.create(x, {
  id: "session:a",
  channel: "dashboard",
  channel_target: "a",
  created_at: 1,
  last_active_at: 1,
  config: "{}",
  alias: "Alpha Session",
});
xEmbeddingStore(x).createChunk(x, {
  sessionId: "session:a",
  day: "2026-01-01",
  chunkIndex: 3,
  text: "alpha project decision",
  context: "Discussion of the alpha project",
  embeddedText: "Discussion of the alpha project\n\nalpha project decision",
  messageIdStart: 1,
  messageIdEnd: 2,
  messageCount: 2,
  vector: new Float32Array([1, 0]),
});

const app = express();
app.use(express.json());
app.use("/api/memory", await new MemoryRouterService().createRouter(x));

const profileSchema = z.object({ content: z.string().nullable() });
const statsSchema = z.object({
  totalChunks: z.number(),
  totalSessions: z.number(),
  totalDays: z.number(),
  sessions: z.array(z.object({
    session_id: z.string(),
    alias: z.string().nullable(),
  }).passthrough()),
}).passthrough();
const searchSchema = z.object({
  query: z.string(),
  mode: z.string(),
  duration_ms: z.number(),
  results: z.array(z.object({
    session_id: z.string(),
    chunk_index: z.number(),
    text: z.string(),
  }).passthrough()),
});

let server: Server;
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  xEmbeddingDb(x).close();
  db.close();
  rmSync(userDir, { recursive: true, force: true });
});

describe("memory router", () => {
  it("returns profile and embedding statistics with session aliases", async () => {
    const profileResponse = await fetch(`${baseUrl}/api/memory/profile`);
    assert.equal(profileResponse.status, 200);
    assert.equal(
      profileSchema.parse(await profileResponse.json()).content,
      "# Test Profile\n"
    );

    const statsResponse = await fetch(`${baseUrl}/api/memory/embeddings/stats`);
    assert.equal(statsResponse.status, 200);
    const stats = statsSchema.parse(await statsResponse.json());
    assert.equal(stats.totalChunks, 1);
    assert.equal(stats.totalSessions, 1);
    assert.equal(stats.sessions[0]?.alias, "Alpha Session");
  });

  it("runs BM25 search through MemoryService and preserves chunk metadata", async () => {
    const response = await fetch(
      `${baseUrl}/api/memory/embeddings/search?q=alpha&mode=bm25&session=session%3Aa`
    );
    assert.equal(response.status, 200);
    const result = searchSchema.parse(await response.json());
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.session_id, "session:a");
    assert.equal(result.results[0]?.chunk_index, 3);
  });

  it("returns structured errors for invalid search inputs", async () => {
    const response = await fetch(
      `${baseUrl}/api/memory/embeddings/search?q=alpha&limit=0`
    );
    assert.equal(response.status, 400);
  });
});
