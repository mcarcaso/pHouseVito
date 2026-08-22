import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { z } from "zod";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import {
  registerRoute,
  emptyRouteSchema,
  unknownRouteSchema,
} from "../../src/routers/register-route.js";
import { DashboardAuthRouterService } from "../../src/routers/DashboardAuthRouterService.js";
import { InMemoryDashboardAuthService } from "../../src/services/auth/InMemoryDashboardAuthService.js";
import { FileSecretService } from "../../src/services/secrets/FileSecretService.js";

const root = mkdtempSync(join(tmpdir(), "vito-dashboard-auth-router-"));
const x = new ObjectContext({
  secretsPath: () => join(root, "secrets.json"),
  secretService: () => new FileSecretService(),
  dashboardAuthService: () => new InMemoryDashboardAuthService(),
});
const app = express();
app.use("/api/auth", await new DashboardAuthRouterService().createRouter(x));
const emptySchemas = {
  params: emptyRouteSchema,
  query: emptyRouteSchema,
  body: unknownRouteSchema,
};
const registerProtectedRoute = (path: string) =>
  registerRoute(x, {
    router: app,
    method: "GET",
    path,
    auth: "dashboard",
    schemas: emptySchemas,
    responseSchema: z.object({ ok: z.literal(true) }),
    handler: () => ({ ok: true as const }),
  });
registerProtectedRoute("/api/protected");
registerProtectedRoute("/api/server/status");
registerProtectedRoute("/api/auth/provider/test");
registerProtectedRoute("/attachments/test");
registerRoute(x, {
  router: app,
  method: "GET",
  path: "/api/health",
  auth: "public",
  schemas: emptySchemas,
  responseSchema: z.object({ public: z.literal(true) }),
  handler: () => ({ public: true as const }),
});

let server: Server;
let baseUrl: string;
let password = "";
let cookie = "";

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
  rmSync(root, { recursive: true, force: true });
});

describe("dashboard authentication routes", () => {
  it("preserves first-time setup restrictions and public auth routes", async () => {
    assert.equal((await fetch(`${baseUrl}/api/protected`)).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/server/status`)).status, 403);
    assert.equal((await fetch(`${baseUrl}/attachments/test`)).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/auth/provider/test`)).status, 403);

    const setup = await fetch(`${baseUrl}/api/auth/setup`, { method: "POST" });
    assert.equal(setup.status, 200);
    password = z
      .object({ ok: z.literal(true), password: z.string() })
      .parse(await setup.json()).password;
    cookie = setup.headers.get("set-cookie") ?? "";
    assert.ok(cookie.startsWith("session="));
  });

  it("checks sessions and protects API and attachment routes", async () => {
    const check = await fetch(`${baseUrl}/api/auth/check`, {
      headers: { cookie },
    });
    assert.deepEqual(await check.json(), {
      authenticated: true,
      passwordSet: true,
    });
    assert.equal((await fetch(`${baseUrl}/api/protected`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/server/status`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/auth/provider/test`)).status, 401);
    assert.equal(
      (
        await fetch(`${baseUrl}/api/protected`, {
          headers: { cookie },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/server/status`, {
          headers: { cookie },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/attachments/test`, {
          headers: { cookie },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/api/auth/provider/test`, {
          headers: { cookie },
        })
      ).status,
      200,
    );
  });

  it("preserves login and logout response behavior", async () => {
    const invalid = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "bad" }),
    });
    assert.equal(invalid.status, 401);
    assert.deepEqual(await invalid.json(), { error: "Invalid password" });

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    assert.equal(login.status, 200);
    const loginCookie = login.headers.get("set-cookie") ?? "";

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: loginCookie },
    });
    assert.equal(logout.status, 200);
    assert.deepEqual(await logout.json(), { ok: true });
    assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0$/);
    assert.equal(
      (
        await fetch(`${baseUrl}/api/protected`, {
          headers: { cookie: loginCookie },
        })
      ).status,
      401,
    );
  });
});
