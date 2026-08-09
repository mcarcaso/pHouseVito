import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import type { AskApiOptions } from "../../src/contracts/ask-api.js";
import { AskApiRouterService } from "../../src/routers/ask/ask-api-router.js";
import { DefaultAskApiService } from "../../src/services/ask/DefaultAskApiService.js";

const secrets = new Map<string, string>();
const askService = new DefaultAskApiService();
const x = new ObjectContext({
  askApiService: () => askService,
  secretService: () => ({
    get: (_x: ObjectContext, key: string) => secrets.get(key),
  }),
});
const app = express();
app.use(express.json());
app.use("/api/ask", await new AskApiRouterService().createRouter(x));

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
});

async function postAsk(body: unknown, authorization?: string): Promise<Response> {
  return await fetch(`${baseUrl}/api/ask`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("Ask API router", () => {
  it("preserves disabled and bearer-authentication responses", async () => {
    secrets.clear();
    let response = await postAsk({ question: "Hello" });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Ask API is disabled — no VITO_ASK_API_KEY configured",
    });

    secrets.set("VITO_ASK_API_KEY", "secret");
    response = await postAsk({ question: "Hello" }, "Bearer wrong");
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "Unauthorized — invalid or missing API key",
    });
  });

  it("checks handler configuration before request validation", async () => {
    const response = await postAsk({}, "Bearer secret");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Ask handler not configured" });
  });

  it("validates requests without invoking the handler", async () => {
    let calls = 0;
    askService.configure(x, async () => {
      calls += 1;
      return "unused";
    });
    const response = await postAsk({ question: 42 }, "secret");
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
    const body = await response.json();
    assert.equal(body.error, "Invalid request");
  });

  it("preserves options, defaults, and response fields", async () => {
    const received: AskApiOptions[] = [];
    askService.configure(x, async (options) => {
      received.push(options);
      return "Voice answer";
    });
    const response = await postAsk({
      question: "What time is it?",
      session: "api:bland-phone",
      author: "phone",
      channelPrompt: "No markdown",
      timeoutMs: 5000,
      relayToSession: true,
      ignoredCompatibilityField: "ignored",
    }, "Bearer secret");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.answer, "Voice answer");
    assert.equal(typeof body.elapsed, "number");
    assert.deepEqual(received, [{
      question: "What time is it?",
      session: "api:bland-phone",
      author: "phone",
      channelPrompt: "No markdown",
      timeoutMs: 5000,
      relayToSession: true,
    }]);

    const defaultsResponse = await postAsk({
      question: "Use defaults",
      session: null,
      author: null,
      channelPrompt: null,
      timeoutMs: null,
      relayToSession: null,
    }, "Bearer secret");
    assert.equal(defaultsResponse.status, 200);
    assert.deepEqual(received[1], {
      question: "Use defaults",
      session: undefined,
      author: undefined,
      channelPrompt: undefined,
      timeoutMs: undefined,
      relayToSession: false,
    });
  });

  it("preserves the public failure response", async () => {
    askService.configure(x, async () => {
      throw new Error("pipeline failed");
    });
    const response = await postAsk({ question: "Hello" }, "Bearer secret");
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "Failed to process question",
      answer: "I hit a snag. Try again.",
    });
  });
});
