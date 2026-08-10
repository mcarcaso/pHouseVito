import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";
import {
  ModelRouterService,
  ProviderAuthRouterService,
} from "../../src/routers/ProviderRouterService.js";
import type {
  ProviderLoginStartResult,
  ProviderLoginStatus,
  ProviderOverview,
  ProviderService,
} from "../../src/services/providers/ProviderService.js";
import { ProviderLoginConflictError } from "../../src/services/providers/ProviderService.js";
import type { Context } from "../../src/context/Context.js";

class TestProviderService implements ProviderService {
  waitingForPrompt = false;
  loggedOut = "";

  async getOverview(_x: Context): Promise<ProviderOverview> {
    return {
      providers: ["test"],
      keyStatus: { test: true },
      authStatus: { test: { hasAuth: true, authType: "api_key" } },
      keyInfo: {},
      oauthProviders: [{ id: "test", name: "Test" }],
    };
  }

  async listModels(_x: Context, providerId: string): Promise<{ id: string }[]> {
    if (providerId !== "test") throw new Error("Unknown provider");
    return [{ id: "model" }];
  }

  async startLogin(_x: Context, providerId: string): Promise<ProviderLoginStartResult> {
    if (providerId === "busy") throw new ProviderLoginConflictError("Login already in progress");
    return { status: "login_started", url: "https://login.example.com" };
  }

  getLoginStatus(_x: Context, providerId: string): ProviderLoginStatus {
    return providerId === "prompt"
      ? { status: "prompt", promptMessage: "Enter code" }
      : { status: "none" };
  }

  submitPrompt(_x: Context, args: { providerId: string; value: string }): void {
    if (args.providerId !== "prompt") {
      throw new ProviderLoginConflictError("No login prompt is waiting for this provider");
    }
    this.waitingForPrompt = args.value === "code";
  }

  async logout(_x: Context, providerId: string): Promise<void> {
    this.loggedOut = providerId;
  }
}

const service = new TestProviderService();
const x = dashboardRouterContext({ providerService: () => service });
const app = express();
app.use(express.json());
app.use("/api/models", await new ModelRouterService().createRouter(x));
app.use("/api/auth/provider", await new ProviderAuthRouterService().createRouter(x));

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

describe("provider routers", () => {
  it("preserves model discovery responses", async () => {
    const overview = await fetch(`${baseUrl}/api/models/providers`);
    assert.equal(overview.status, 200);
    assert.deepEqual(await overview.json(), await service.getOverview(x));

    const models = await fetch(`${baseUrl}/api/models/test`);
    assert.equal(models.status, 200);
    assert.deepEqual(await models.json(), [{ id: "model" }]);
    assert.equal((await fetch(`${baseUrl}/api/models/unknown`)).status, 400);
  });

  it("starts logins and preserves conflict responses", async () => {
    const login = await fetch(`${baseUrl}/api/auth/provider/test/login`, { method: "POST" });
    assert.equal(login.status, 200);
    assert.deepEqual(await login.json(), {
      status: "login_started",
      url: "https://login.example.com",
    });
    const conflict = await fetch(`${baseUrl}/api/auth/provider/busy/login`, { method: "POST" });
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), { error: "Login already in progress" });
  });

  it("polls and submits login prompts and logs out", async () => {
    const status = await fetch(`${baseUrl}/api/auth/provider/prompt/login/status`);
    assert.deepEqual(await status.json(), { status: "prompt", promptMessage: "Enter code" });

    const missing = await fetch(`${baseUrl}/api/auth/provider/prompt/login/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "  " }),
    });
    assert.equal(missing.status, 400);

    const submitted = await fetch(`${baseUrl}/api/auth/provider/prompt/login/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: " code " }),
    });
    assert.equal(submitted.status, 200);
    assert.equal(service.waitingForPrompt, true);

    const logout = await fetch(`${baseUrl}/api/auth/provider/test/logout`, { method: "POST" });
    assert.equal(logout.status, 200);
    assert.equal(service.loggedOut, "test");
  });
});
