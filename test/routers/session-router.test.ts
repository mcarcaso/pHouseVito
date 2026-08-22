import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { z } from "zod";
import { RootContext } from "../../src/context/RootContext.js";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import { xMessageStore, xSessionStore } from "../../src/lib/x.js";
import { SessionRouterService } from "../../src/routers/SessionRouterService.js";

const userDir = mkdtempSync(join(tmpdir(), "vito-session-router-"));
const exampleConfigPath = join(process.cwd(), "user.example", "vito.config.json");
writeFileSync(join(userDir, "vito.config.json"), readFileSync(exampleConfigPath, "utf-8"));
writeFileSync(join(userDir, "SOUL.md"), "test soul\n");

const db = createDatabase(":memory:");
const x = dashboardRouterContext(
  {},
  RootContext({ db, userDir, skillsDir: join(userDir, "skills") }),
);
const sessionId = "dashboard:test";
const sessionStore = xSessionStore(x);
sessionStore.create(x, {
  id: sessionId,
  channel: "dashboard",
  channel_target: "test",
  created_at: 1,
  last_active_at: 1,
  config: "{}",
  alias: null,
});
xMessageStore(x).create(x, {
  session_id: sessionId,
  channel: "dashboard",
  channel_target: "test",
  timestamp: 1,
  type: "user",
  content: JSON.stringify("hello"),
  archived: 0,
  author: "tester",
});

const sessionsResponseSchema = z.array(z.object({ id: z.string() }).passthrough());
const messagesResponseSchema = z.object({
  messages: z.array(z.unknown()),
  total: z.number(),
});
const validationResponseSchema = z.object({
  error: z.string(),
  issues: z.array(z.object({ path: z.string() }).passthrough()),
});
const settingsResponseSchema = z.record(z.string(), z.unknown());

const app = express();
app.use("/api/sessions", await new SessionRouterService().createRouter(x));

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
    server.close((error) => (error ? reject(error) : resolve()));
  });
  db.close();
  rmSync(userDir, { recursive: true, force: true });
});

describe("session router", () => {
  it("lists sessions and messages", async () => {
    const sessionsResponse = await fetch(`${baseUrl}/api/sessions`);
    assert.equal(sessionsResponse.status, 200);
    const sessions = sessionsResponseSchema.parse(await sessionsResponse.json());
    assert.equal(sessions.length, 1);

    const messagesResponse = await fetch(
      `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=10`,
    );
    assert.equal(messagesResponse.status, 200);
    const messages = messagesResponseSchema.parse(await messagesResponse.json());
    assert.equal(messages.messages.length, 1);
    assert.equal(messages.total, 1);
  });

  it("returns structured validation errors", async () => {
    const response = await fetch(
      `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages?hideTools=yes`,
    );
    assert.equal(response.status, 400);
    const result = validationResponseSchema.parse(await response.json());
    assert.equal(result.error, "Invalid request");
    assert.equal(result.issues[0]?.path, "query.hideTools");
  });

  it("validates and updates aliases", async () => {
    const invalidResponse = await fetch(
      `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/alias`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: 42 }),
      },
    );
    assert.equal(invalidResponse.status, 400);

    const response = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/alias`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alias: "  Test Session  " }),
    });
    assert.equal(response.status, 200);
    assert.equal(sessionStore.list(x, { ids: [sessionId], limit: 1 })[0]?.alias, "Test Session");
  });

  it("validates, saves, and removes session settings", async () => {
    const url = `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/config`;
    const invalidResponse = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ streamMode: "invalid" }),
    });
    assert.equal(invalidResponse.status, 400);

    const saveResponse = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ streamMode: "final", customInstructions: "test" }),
    });
    assert.equal(saveResponse.status, 200);

    const savedResponse = await fetch(url);
    const saved = settingsResponseSchema.parse(await savedResponse.json());
    assert.equal(saved.streamMode, "final");
    assert.equal(saved.customInstructions, "test");

    const removeResponse = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customInstructions: null }),
    });
    assert.equal(removeResponse.status, 200);
    const updated = settingsResponseSchema.parse(await removeResponse.json());
    assert.equal("customInstructions" in updated, false);
    assert.equal(updated.streamMode, "final");
  });
});
