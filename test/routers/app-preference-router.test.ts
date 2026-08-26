import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import { AppPreferenceRouterService } from "../../src/routers/AppPreferenceRouterService.js";
import { SqliteAppPreferenceStore } from "../../src/stores/app-preferences/SqliteAppPreferenceStore.js";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";

let server: Server;
let baseUrl: string;
const db = createDatabase(":memory:");

before(async () => {
  const app = express();
  const x = dashboardRouterContext({
    db: () => db,
    appPreferenceStore: () => new SqliteAppPreferenceStore(),
  });
  app.use("/api/app-preferences", await new AppPreferenceRouterService().createRouter(x));
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
});

describe("app preference router", () => {
  it("returns an empty preference document before first sync", async () => {
    const response = await fetch(`${baseUrl}/api/app-preferences`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { preferences: {}, updatedAt: null });
  });

  it("patches one preference group without replacing another", async () => {
    const speechResponse = await fetch(`${baseUrl}/api/app-preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        speech: {
          provider: "openai",
          voice: "alloy",
          rate: 1,
          instructions: "Speak with calm precision.",
        },
      }),
    });
    assert.equal(speechResponse.status, 200);

    const voiceResponse = await fetch(`${baseUrl}/api/app-preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voiceMode: {
          provider: "gemini",
          model: "gpt-realtime-mini",
          openaiVoice: "marin",
          geminiVoice: "Kore",
        },
      }),
    });
    assert.equal(voiceResponse.status, 200);
    const body = (await voiceResponse.json()) as {
      preferences: {
        speech?: { voice: string; instructions?: string };
        voiceMode?: { provider: string };
      };
    };
    assert.equal(body.preferences.speech?.voice, "alloy");
    assert.equal(body.preferences.speech?.instructions, "Speak with calm precision.");
    assert.equal(body.preferences.voiceMode?.provider, "gemini");
  });
});
