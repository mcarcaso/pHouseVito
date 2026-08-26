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

async function withProviderFetch(
  provider: (url: string, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return url.startsWith(baseUrl) ? original(input, init) : provider(url, init);
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

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

  it("proxies provider PCM without buffering it into JSON", async () => {
    const expected = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    await withProviderFetch(
      async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as { response_format?: string };
        assert.equal(request.response_format, "pcm");
        return new Response(expected, { status: 200, headers: { "Content-Type": "audio/pcm" } });
      },
      async () => {
        const response = await fetch(`${baseUrl}/api/speech/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "openai", voice: "alloy", text: "Hello" }),
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("x-audio-sample-rate"), "24000");
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), expected);
      },
    );
  });

  it("decodes Gemini streaming audio deltas into PCM", async () => {
    const expected = Uint8Array.from([9, 8, 7, 6]);
    await withProviderFetch(
      async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as { stream?: boolean };
        assert.equal(request.stream, true);
        const event = JSON.stringify({
          event_type: "step.delta",
          delta: { type: "audio", data: Buffer.from(expected).toString("base64") },
        });
        return new Response(`data: ${event}\n\ndata: [DONE]\n\n`, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
      async () => {
        const response = await fetch(`${baseUrl}/api/speech/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "gemini", voice: "Enceladus", text: "Hello" }),
        });
        assert.equal(response.status, 200);
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), expected);
      },
    );
  });
});
