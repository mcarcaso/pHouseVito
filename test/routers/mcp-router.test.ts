import assert from "node:assert/strict";
import type { Server } from "node:http";
import { test } from "node:test";
import express from "express";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { ConfigMcpStore } from "../../src/stores/mcp/ConfigMcpStore.js";
import { DefaultMcpService } from "../../src/services/mcp/DefaultMcpService.js";
import { McpRouterService } from "../../src/routers/McpRouterService.js";

test("MCP routes require owner dashboard authentication and validate mutations", async () => {
  let config = { settings: {}, channels: {}, cron: { jobs: [] } };
  const x = new ObjectContext({
    dashboardAuthService: () => ({
      isPasswordSet: () => true,
      isAuthenticated: (_x: unknown, _cookie: unknown, authorization: unknown) =>
        authorization === "Bearer test-owner",
    }),
    vitoService: () => ({
      getConfig: () => structuredClone(config),
      saveConfig: (_x: unknown, value: typeof config) => {
        config = value;
        return config;
      },
    }),
    mcpOAuthService: () => ({ revision: () => "", status: () => ({ status: "none" }) }),
    mcpStore: () => new ConfigMcpStore(),
    mcpService: () => new DefaultMcpService(),
    secretService: () => ({ get: () => undefined }),
  });
  const app = express();
  app.use("/api/mcp", await new McpRouterService().createRouter(x));
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/mcp`;
  const headers = { Authorization: "Bearer test-owner", "Content-Type": "application/json" };
  try {
    for (const [method, path] of [
      ["GET", ""],
      ["PUT", ""],
      ["DELETE", "/docs"],
      ["POST", "/docs/test"],
    ]) {
      const response = await fetch(url + path, { method });
      assert.equal(response.status, 401);
    }
    const invalid = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        name: "docs",
        server: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "plain-secret" },
        },
      }),
    });
    assert.equal(invalid.status, 400);
    const saved = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        name: "docs",
        server: { type: "http", url: "https://example.com/mcp" },
      }),
    });
    assert.equal(saved.status, 200);
    const overview = await saved.json();
    assert.equal(overview.servers[0].server.exposure, "deferred");
    const removed = await fetch(url + "/docs", { method: "DELETE", headers });
    assert.equal(removed.status, 200);
    assert.deepEqual((await removed.json()).servers, []);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
