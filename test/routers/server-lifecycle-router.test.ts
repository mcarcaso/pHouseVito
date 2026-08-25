import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";
import type { Context } from "../../src/context/Context.js";
import { ServerLifecycleRouterService } from "../../src/routers/ServerLifecycleRouterService.js";
import type {
  ServerHealth,
  ServerLifecycleService,
  ServerRestartRequest,
  ServerStatus,
} from "../../src/services/server/ServerLifecycleService.js";

const memoryUsage: NodeJS.MemoryUsage = {
  rss: 1,
  heapTotal: 2,
  heapUsed: 3,
  external: 4,
  arrayBuffers: 5,
};
const system = {
  cpuUsage: 42,
  memoryTotal: 1_000,
  memoryUsed: 600,
  memoryFree: 400,
};

class TestServerLifecycleService implements ServerLifecycleService {
  restartRequests: ServerRestartRequest[] = [];

  getHealth(_x: Context): ServerHealth {
    return { status: "ok", timestamp: "2026-01-02T03:04:05.000Z" };
  }

  getStatus(_x: Context): ServerStatus {
    return { uptime: 12, pid: 34, nodeVersion: "v22.test", memoryUsage, system };
  }

  requestRestart(_x: Context, request: ServerRestartRequest): void {
    this.restartRequests.push(request);
  }
}

const service = new TestServerLifecycleService();
const x = dashboardRouterContext({ serverLifecycleService: () => service });
const app = express();
app.use("/api", await new ServerLifecycleRouterService().createRouter(x));

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

describe("server lifecycle router", () => {
  it("preserves health and server-status responses", async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: "ok",
      timestamp: "2026-01-02T03:04:05.000Z",
    });

    const status = await fetch(`${baseUrl}/api/server/status`);
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), {
      uptime: 12,
      pid: 34,
      nodeVersion: "v22.test",
      memoryUsage,
      system,
    });
  });

  it("preserves restart responses and passes request metadata", async () => {
    const response = await fetch(`${baseUrl}/api/server/restart`, {
      method: "POST",
      headers: {
        "user-agent": "test-agent",
        "x-forwarded-for": "203.0.113.9",
      },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      message: "Rebuilding dashboard and restarting server...",
    });
    assert.deepEqual(service.restartRequests, [
      {
        clientIp: "203.0.113.9",
        userAgent: "test-agent",
      },
    ]);
  });
});
