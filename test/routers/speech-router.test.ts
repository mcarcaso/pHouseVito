import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { SpeechRouterService } from "../../src/routers/SpeechRouterService.js";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";

let server: Server;
let baseUrl: string;

before(async () => {
  const app = express();
  const x = dashboardRouterContext({
    secretService: () => ({ get: () => "configured-test-key" }),
  });
  app.use("/api/speech", await new SpeechRouterService().createRouter(x));
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

describe("speech router", () => {
  it("lists configured voices from a bodyless GET request", async () => {
    const response = await fetch(`${baseUrl}/api/speech/voices?provider=openai`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      configured: boolean;
      voices: Array<{ id: string; name: string }>;
    };
    assert.equal(body.configured, true);
    assert.ok(body.voices.some((voice) => voice.id === "alloy" && voice.name === "Alloy"));
  });

  it("lists Gemini TTS voices", async () => {
    const response = await fetch(`${baseUrl}/api/speech/voices?provider=gemini`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      configured: boolean;
      voices: Array<{ id: string; name: string }>;
    };
    assert.equal(body.configured, true);
    assert.ok(body.voices.some((voice) => voice.id === "Enceladus"));
  });
});
