import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { z } from "zod";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { xDashboardUser } from "../../src/lib/x.js";
import {
  createRoute,
  emptyRouteSchema,
  unknownRouteSchema,
} from "../../src/routers/createRoute.js";
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
app.get(
  "/protected",
  createRoute(
    new ObjectContext({
      dashboardAuthService: () => authenticatedDashboardAuthService,
      askApiService: () => ({ privileged: true }),
    }),
    {
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
        assert.throws(() => x.get("askApiService"));
        return {
          userId: xDashboardUser(x).id,
          excludesUnapprovedDependencies: true as const,
        };
      },
    },
  ),
);
app.get(
  "/unavailable",
  createRoute(
    new ObjectContext({ dashboardAuthService: () => unavailableAuthService }),
    {
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: z.object({ ok: z.literal(true) }),
      handler: () => ({ ok: true as const }),
    },
  ),
);
app.get(
  "/invalid-response",
  createRoute(
    new ObjectContext({
      dashboardAuthService: () => authenticatedDashboardAuthService,
    }),
    {
      auth: "dashboard",
      schemas: {
        params: emptyRouteSchema,
        query: emptyRouteSchema,
        body: unknownRouteSchema,
      },
      responseSchema: z.object({ count: z.number().int() }),
      handler: () => ({ count: 1.5 }),
    },
  ),
);

let server: Server;
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test server address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("createRoute", () => {
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

  it("validates handler responses", async () => {
    const response = await fetch(`${baseUrl}/invalid-response`);
    assert.equal(response.status, 500);
  });
});
