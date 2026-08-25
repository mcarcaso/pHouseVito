import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { VoiceRouterService } from "../../src/routers/VoiceRouterService.js";
import type { VoiceService } from "../../src/services/voice/VoiceService.js";
import { authenticatedDashboardAuthService } from "../support/authenticated-dashboard-auth-service.js";

let requestedRealtimeModel: string | null = null;
const voiceService: VoiceService = {
  getStatus: () => ({ available: true, provider: "openai", reason: null }),
  createRealtimeSecret: async (_x, _voice, model) => {
    requestedRealtimeModel = model;
    return { value: "test" };
  },
  recordEvent: () => undefined,
  listSessions: () => [],
  getSession: () => null,
  getContext: () => ({ profile: "Mike", recentVoiceSessions: [] }),
  searchMemory: async () => [],
  askAsync: () => {
    throw new Error("not used");
  },
  getTask: () => null,
  cancelTask: () => {
    throw new Error("not used");
  },
};

let server: Server;
let baseUrl: string;

before(async () => {
  const app = express();
  app.use(express.json());
  const x = new ObjectContext({
    dashboardAuthService: () => authenticatedDashboardAuthService,
    voiceService: () => voiceService,
  });
  app.use("/api/voice", await new VoiceRouterService().createRouter(x));
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

describe("voice router", () => {
  it("validates and forwards the selected realtime model", async () => {
    const response = await fetch(`${baseUrl}/api/voice/realtime-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voice: "marin", model: "gpt-realtime" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { value: "test" });
    assert.equal(requestedRealtimeModel, "gpt-realtime");
  });

  it("accepts bodyless GET requests for context and sessions", async () => {
    const context = await fetch(`${baseUrl}/api/voice/context`);
    assert.equal(context.status, 200);
    assert.deepEqual(await context.json(), { profile: "Mike", recentVoiceSessions: [] });

    const sessions = await fetch(`${baseUrl}/api/voice/sessions`);
    assert.equal(sessions.status, 200);
    assert.deepEqual(await sessions.json(), []);
  });
});
