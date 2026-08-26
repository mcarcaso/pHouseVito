import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { z } from "zod";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { VitoError } from "../../src/lib/VitoError.js";
import { xDashboardUser } from "../../src/lib/x.js";
import {
  registerRoute,
  emptyRouteSchema,
  unknownRouteSchema,
} from "../../src/routers/register-route.js";
import type { DashboardAuthService } from "../../src/services/auth/DashboardAuthService.js";
import { authenticatedDashboardAuthService } from "../support/authenticated-dashboard-auth-service.js";

const unavailableAuthService: DashboardAuthService = {
  getStatus: () => ({ authenticated: false, passwordSet: false }),
  isPasswordSet: () => false,
  isAuthenticated: () => false,
  setup: () => ({ status: "password_already_set" }),
  login: () => ({ status: "password_not_set" }),
  logout: () => "",
};

const app = express();
registerRoute(
  new ObjectContext({
    dashboardAuthService: () => authenticatedDashboardAuthService,
    rootOnlyDependency: () => ({ privileged: true }),
  }),
  {
    router: app,
    method: "GET",
    path: "/protected",
    auth: "dashboard",
    schemas: {
      params: emptyRouteSchema,
      query: emptyRouteSchema,
      body: unknownRouteSchema,
    },
    responseSchema: z.object({
      userId: z.literal("owner"),
      excludesUnapprovedDependencies: z.literal(true),
    }),
    handler: (x) => {
      assert.throws(() => x.get("rootOnlyDependency"));
      return {
        userId: xDashboardUser(x).id,
        excludesUnapprovedDependencies: true as const,
      };
    },
  },
);
registerRoute(new ObjectContext({ dashboardAuthService: () => unavailableAuthService }), {
  router: app,
  method: "GET",
  path: "/unavailable",
  auth: "dashboard",
  schemas: {
    params: emptyRouteSchema,
    query: emptyRouteSchema,
    body: unknownRouteSchema,
  },
  responseSchema: z.object({ ok: z.literal(true) }),
  handler: () => ({ ok: true as const }),
});
const authenticatedX = new ObjectContext({
  dashboardAuthService: () => authenticatedDashboardAuthService,
});
const registerBasicRoute = (path: string, handler: () => unknown) =>
  registerRoute(authenticatedX, {
    router: app,
    method: "GET",
    path,
    auth: "dashboard",
    schemas: {
      params: emptyRouteSchema,
      query: emptyRouteSchema,
      body: unknownRouteSchema,
    },
    responseSchema: z.object({ ok: z.literal(true) }),
    handler,
  });

registerRoute(authenticatedX, {
  router: app,
  method: "GET",
  path: "/invalid-response",
  auth: "dashboard",
  schemas: {
    params: emptyRouteSchema,
    query: emptyRouteSchema,
    body: unknownRouteSchema,
  },
  responseSchema: z.object({ count: z.number().int() }),
  handler: () => ({ count: 1.5 }),
});
registerBasicRoute("/not-found", () => {
  throw new VitoError({
    code: "NOT_FOUND",
    message: "Widget not found",
    resource: "widget",
  });
});
registerBasicRoute("/private-error", () => {
  throw new Error("provider response contained a private diagnostic");
});
registerBasicRoute("/hostile-error", () => {
  const hostile = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(hostile, "name", {
    get: () => {
      throw new Error("name getter should not run");
    },
  });
  hostile.self = hostile;
  throw hostile;
});

registerRoute(new ObjectContext({ dashboardAuthService: () => unavailableAuthService }), {
  router: app,
  method: "POST",
  path: "/unavailable-with-body",
  auth: "dashboard",
  schemas: {
    params: emptyRouteSchema,
    query: emptyRouteSchema,
    body: z.object({ value: z.string() }),
  },
  responseSchema: z.object({ ok: z.literal(true) }),
  handler: () => ({ ok: true as const }),
});

registerRoute(new ObjectContext({}), {
  router: app,
  method: "POST",
  path: "/small-public-body",
  auth: "public",
  jsonLimit: 16,
  schemas: {
    params: emptyRouteSchema,
    query: emptyRouteSchema,
    body: z.object({ value: z.string() }),
  },
  responseSchema: z.object({ ok: z.literal(true) }),
  handler: () => ({ ok: true as const }),
});

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

describe("registerRoute", () => {
  it("authenticates and passes a dashboard user context to handlers", async () => {
    const response = await fetch(`${baseUrl}/protected`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      userId: "owner",
      excludesUnapprovedDependencies: true,
    });
  });

  it("rejects dashboard requests before invoking handlers", async () => {
    const response = await fetch(`${baseUrl}/unavailable`);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "Dashboard password not set. Complete /api/auth/setup first.",
    });
  });

  it("rejects unauthenticated requests before parsing their JSON body", async () => {
    const response = await fetch(`${baseUrl}/unavailable-with-body`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ malformed",
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "Dashboard password not set. Complete /api/auth/setup first.",
    });
  });

  it("enforces route-specific JSON body limits", async () => {
    const response = await fetch(`${baseUrl}/small-public-body`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "a body larger than sixteen bytes" }),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "Request body too large" });
  });

  it("validates handler responses without exposing schema internals", async () => {
    const response = await fetch(`${baseUrl}/invalid-response`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  });

  it("maps validated Vito errors to structured HTTP responses", async () => {
    const response = await fetch(`${baseUrl}/not-found`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: "Widget not found",
      code: "NOT_FOUND",
      details: { resource: "widget" },
    });
  });

  it("does not expose unexpected error details", async () => {
    const response = await fetch(`${baseUrl}/private-error`);
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.deepEqual(body, {
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
    assert.doesNotMatch(JSON.stringify(body), /private diagnostic/);
  });

  it("handles hostile thrown values without inspecting them", async () => {
    const response = await fetch(`${baseUrl}/hostile-error`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    });
  });
});
