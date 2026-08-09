import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { z } from "zod";
import { RootContext } from "../../src/context/RootContext.js";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";
import { createDatabase } from "../../src/db/schema.js";
import { xSessionStore } from "../../src/lib/x.js";
import { PiSessionRouterService } from "../../src/routers/pi-sessions/pi-session-router.js";

const userDir = mkdtempSync(join(tmpdir(), "vito-pi-session-router-"));
const piSessionsDir = join(userDir, "pi-sessions");
const sessionDirectory = join(piSessionsDir, "dashboard%3Atest");
mkdirSync(sessionDirectory, { recursive: true });
writeFileSync(join(sessionDirectory, "pi-1.jsonl"), [
  JSON.stringify({ type: "session", id: "pi-1", timestamp: "2026-01-01", cwd: "/app" }),
  JSON.stringify({ type: "message", message: { role: "user", content: "hello" } }),
].join("\n"));

const db = createDatabase(":memory:");
const x = dashboardRouterContext({}, RootContext({ db, userDir, skillsDir: join(userDir, "skills"), piSessionsDir }));
xSessionStore(x).create(x, {
  id: "dashboard:test",
  channel: "dashboard",
  channel_target: "test",
  created_at: 1,
  last_active_at: 1,
  config: "{}",
  alias: "Test Session",
});

const app = express();
app.use(express.json());
app.use("/api/pi-sessions", await new PiSessionRouterService().createRouter(x));

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
  rmSync(userDir, { recursive: true, force: true });
});

describe("Pi session router", () => {
  it("lists session metadata with Vito aliases", async () => {
    const response = await fetch(`${baseUrl}/api/pi-sessions`);
    assert.equal(response.status, 200);
    const result = z.object({
      files: z.array(z.object({
        rel: z.string(),
        vitoSessionId: z.string(),
        alias: z.string().nullable(),
        messageCount: z.number(),
      }).passthrough()),
    }).parse(await response.json());
    assert.equal(result.files[0].rel, "dashboard%3Atest/pi-1.jsonl");
    assert.equal(result.files[0].alias, "Test Session");
    assert.equal(result.files[0].messageCount, 1);
  });

  it("reads validated JSONL and rejects traversal", async () => {
    const response = await fetch(
      `${baseUrl}/api/pi-sessions/dashboard%253Atest/pi-1.jsonl`
    );
    assert.equal(response.status, 200);
    const result = z.object({
      rel: z.string(),
      format: z.literal("jsonl"),
      lines: z.array(z.record(z.unknown())),
    }).parse(await response.json());
    assert.equal(result.lines.length, 2);

    const traversal = await fetch(
      `${baseUrl}/api/pi-sessions/dashboard%253Atest/..%5Coutside.jsonl`
    );
    assert.equal(traversal.status, 400);
  });

  it("deletes individual and all sessions", async () => {
    const missing = await fetch(
      `${baseUrl}/api/pi-sessions/dashboard%253Atest/missing.jsonl`,
      { method: "DELETE" }
    );
    assert.equal(missing.status, 404);

    const response = await fetch(
      `${baseUrl}/api/pi-sessions/dashboard%253Atest/pi-1.jsonl`,
      { method: "DELETE" }
    );
    assert.equal(response.status, 200);

    const all = await fetch(`${baseUrl}/api/pi-sessions`, { method: "DELETE" });
    assert.equal(all.status, 200);
    assert.deepEqual(await all.json(), { success: true, deleted: 0 });
  });
});
