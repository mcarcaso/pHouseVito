import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";
import { DashboardChatRouterService } from "../../src/routers/chat/dashboard-chat-router.js";
import { DefaultDashboardChatService } from "../../src/services/chat/DefaultDashboardChatService.js";
import type { InboundEvent } from "../../src/types.js";

const chatService = new DefaultDashboardChatService();
const x = dashboardRouterContext({ dashboardChatService: () => chatService });
const app = express();
app.use(express.json());
app.use("/api/chat", await new DashboardChatRouterService().createRouter(x));

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

async function postChat(body: unknown): Promise<Response> {
  return await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("dashboard chat router", () => {
  it("preserves the no-handler response", async () => {
    const response = await postChat({ type: "chat", content: "Hello" });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Invalid chat message or no handler",
    });
  });

  it("rejects malformed and empty chat messages", async () => {
    const events: InboundEvent[] = [];
    chatService.configure(x, (event) => events.push(event));

    for (const body of [
      { type: "other", content: "Hello" },
      { type: "chat", content: "" },
      { type: "chat", attachments: [{ type: "executable" }] },
    ]) {
      const response = await postChat(body);
      assert.equal(response.status, 400);
      const result = await response.json();
      assert.equal(result.error, "Invalid request");
    }
    assert.equal(events.length, 0);
  });

  it("dispatches text and attachment messages with the existing response", async () => {
    const events: InboundEvent[] = [];
    chatService.configure(x, (event) => events.push(event));
    const response = await postChat({
      type: "chat",
      content: "Dashboard message",
      sessionId: "dashboard:work",
      attachments: [{
        type: "file",
        path: "/tmp/report.txt",
        filename: "report.txt",
        custom: "preserved",
      }],
      custom: "preserved",
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.sessionKey, "dashboard:work");
    assert.equal(events[0]?.target, "work");
    assert.equal(events[0]?.raw.custom, "preserved");
    assert.equal(events[0]?.attachments?.[0]?.path, "/tmp/report.txt");
  });
});
