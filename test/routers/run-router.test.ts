import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";
import { RunRouterService } from "../../src/routers/RunRouterService.js";
import type { OrchestratorRun } from "../../src/services/orchestrator/OrchestratorService.js";

const runs: OrchestratorRun[] = [
  {
    sessionKey: "discord:channel-1",
    channel: "dashboard",
    author: "user",
    preview: "Please change direction",
    status: "queued",
    timestamp: 1,
    id: "dashboard-request",
  },
  {
    sessionKey: "telegram:chat-1",
    channel: "telegram",
    author: "someone else",
    preview: "A Telegram message",
    status: "queued",
    timestamp: 2,
    id: "telegram-request",
  },
];
const calls: Array<{ sessionKey: string; id: string; authorId: string }> = [];
const x = dashboardRouterContext({
  orchestratorService: () => ({
    listRuns: () => runs,
    steerQueued: async (_x: unknown, sessionKey: string, id: string, authorId: string) => {
      calls.push({ sessionKey, id, authorId });
      return "steered";
    },
  }),
});
const app = express();
app.use("/api/runs", await new RunRouterService().createRouter(x));
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
});

async function steer(sessionKey: string, id: string) {
  const response = await fetch(`${baseUrl}/api/runs/steer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionKey, id }),
  });
  return { status: response.status, body: await response.json() };
}

describe("run steering route", () => {
  it("accepts a dashboard-authored queued message in a Discord-named session", async () => {
    assert.deepEqual(await steer("discord:channel-1", "dashboard-request"), {
      status: 200,
      body: { result: "steered" },
    });
    assert.deepEqual(calls.at(-1), {
      sessionKey: "discord:channel-1",
      id: "dashboard-request",
      authorId: "owner",
    });
  });

  it("does not steer a queued message authored on Telegram", async () => {
    const count = calls.length;
    assert.deepEqual(await steer("telegram:chat-1", "telegram-request"), {
      status: 200,
      body: { result: "forbidden" },
    });
    assert.equal(calls.length, count);
  });
});
