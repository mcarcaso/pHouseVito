import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { z } from "zod";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";
import { AppRouterService } from "../../src/routers/apps/app-router.js";
import type {
  AppProcessAction,
  AppProcessService,
  AppProcessStatus,
} from "../../src/services/apps/AppProcessService.js";
import { FileAppStore } from "../../src/stores/apps/FileAppStore.js";
import type { Context } from "../../src/context/Context.js";

class TestAppProcessService implements AppProcessService {
  readonly actions: { action: AppProcessAction; appName: string }[] = [];

  async list(_x: Context, appNames?: string[]): Promise<AppProcessStatus[]> {
    if (appNames && !appNames.includes("alpha")) return [];
    return [{
      name: "alpha",
      status: "online",
      uptime: 1000,
      restarts: 2,
      memory: 123,
    }];
  }

  async execute(
    _x: Context,
    args: { action: AppProcessAction; appName: string }
  ): Promise<void> {
    this.actions.push(args);
  }
}

const root = mkdtempSync(join(tmpdir(), "vito-app-router-"));
const appDirectory = join(root, "alpha");
mkdirSync(join(appDirectory, "src"), { recursive: true });
writeFileSync(join(appDirectory, ".vito-app.json"), JSON.stringify({
  description: "Alpha",
  port: 4000,
  url: "https://alpha.example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
}));
writeFileSync(join(appDirectory, "src", "index.ts"), "export {};\n");
const processes = new TestAppProcessService();
const x = dashboardRouterContext({
  appsDir: () => root,
  appStore: () => new FileAppStore(),
  appProcessService: () => processes,
});
const app = express();
app.use(express.json());
app.use("/api/apps", await new AppRouterService().createRouter(x));

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
  rmSync(root, { recursive: true, force: true });
});

describe("app router", () => {
  it("lists app metadata merged with process status", async () => {
    const response = await fetch(`${baseUrl}/api/apps`);
    assert.equal(response.status, 200);
    const apps = z.array(z.object({
      name: z.string(),
      status: z.string(),
      memory: z.number().nullable(),
    }).passthrough()).parse(await response.json());
    assert.equal(apps[0].name, "alpha");
    assert.equal(apps[0].status, "online");
    assert.equal(apps[0].memory, 123);
  });

  it("lists and reads safe app files", async () => {
    const filesResponse = await fetch(`${baseUrl}/api/apps/alpha/files`);
    assert.equal(filesResponse.status, 200);
    const files = z.array(z.object({ path: z.string(), size: z.number(), isDir: z.boolean() }))
      .parse(await filesResponse.json());
    assert.ok(files.some((file) => file.path === "src/index.ts"));

    const fileResponse = await fetch(`${baseUrl}/api/apps/alpha/files/src/index.ts`);
    assert.equal(fileResponse.status, 200);
    assert.deepEqual(await fileResponse.json(), { content: "export {};\n", size: 11 });

    const traversal = await fetch(`${baseUrl}/api/apps/alpha/files/..%5Csecret`);
    assert.equal(traversal.status, 400);
  });

  it("delegates lifecycle operations and deletes app persistence", async () => {
    const restart = await fetch(`${baseUrl}/api/apps/alpha/restart`, { method: "POST" });
    assert.equal(restart.status, 200);
    assert.deepEqual(processes.actions[0], { action: "restart", appName: "alpha" });

    const deleted = await fetch(`${baseUrl}/api/apps/alpha`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.deepEqual(processes.actions[1], { action: "delete", appName: "alpha" });
    assert.equal((await fetch(`${baseUrl}/api/apps/alpha/files`)).status, 404);
  });
});
