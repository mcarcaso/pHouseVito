import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { z } from "zod";
import { RootContext } from "../../src/context/RootContext.js";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";
import { createDatabase } from "../../src/db/schema.js";
import {
  xSessionStore,
  xTraceEventStore,
  xTraceStore,
} from "../../src/lib/x.js";
import { TraceRouterService } from "../../src/routers/TraceRouterService.js";

const logsDir = mkdtempSync(join(tmpdir(), "vito-trace-router-"));
const userDir = mkdtempSync(join(tmpdir(), "vito-trace-user-"));
const db = createDatabase(":memory:");
const x = dashboardRouterContext({}, RootContext({
  db,
  userDir,
  skillsDir: join(userDir, "skills"),
  logsDir,
}));
xSessionStore(x).create(x, {
  id: "dashboard:test",
  channel: "dashboard",
  channel_target: "test",
  created_at: 1,
  last_active_at: 1,
  config: "{}",
  alias: "Test Session",
});
const trace = xTraceStore(x).create(x, {
  timestamp: "2026-01-01T00:00:00.000Z",
  sessionId: "dashboard:test",
  channel: "dashboard",
  target: "test",
  model: "anthropic/test",
  harness: "test-harness",
});
xTraceEventStore(x).create(x, {
  traceId: trace.id,
  data: { type: "user_message", content: "hello" },
});

const app = express();
app.use(express.json());
app.use("/api/logs", await new TraceRouterService().createRouter(x));

const listSchema = z.object({
  files: z.array(z.object({
    filename: z.string(),
    alias: z.string().nullable(),
    userMessage: z.string(),
  }).passthrough()),
  totalCount: z.number(),
  offset: z.number(),
  limit: z.number(),
});
const detailSchema = z.object({
  filename: z.string(),
  format: z.literal("jsonl"),
  lines: z.array(z.object({ type: z.string() }).passthrough()),
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
  db.close();
  rmSync(logsDir, { recursive: true, force: true });
  rmSync(userDir, { recursive: true, force: true });
});

describe("trace router", () => {
  it("lists trace metadata with aliases", async () => {
    const response = await fetch(`${baseUrl}/api/logs?limit=10&offset=0`);
    assert.equal(response.status, 200);
    const result = listSchema.parse(await response.json());
    assert.equal(result.totalCount, 1);
    assert.equal(result.files[0]?.filename, trace.id);
    assert.equal(result.files[0]?.alias, "Test Session");
    assert.equal(result.files[0]?.userMessage, "hello");
  });

  it("returns metadata headers and separately stored events", async () => {
    const response = await fetch(`${baseUrl}/api/logs/${encodeURIComponent(trace.id)}`);
    assert.equal(response.status, 200);
    const result = detailSchema.parse(await response.json());
    assert.deepEqual(result.lines.map((line) => line.type), ["header", "user_message"]);
  });

  it("validates inputs and deletes traces", async () => {
    const invalidResponse = await fetch(`${baseUrl}/api/logs?limit=0`);
    assert.equal(invalidResponse.status, 400);

    const deleteResponse = await fetch(
      `${baseUrl}/api/logs/${encodeURIComponent(trace.id)}`,
      { method: "DELETE" }
    );
    assert.equal(deleteResponse.status, 200);
    assert.equal(xTraceStore(x).count(x, {}), 0);
  });
});
