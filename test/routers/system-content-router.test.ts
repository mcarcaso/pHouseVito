import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import type { Context } from "../../src/context/Context.js";
import type {
  ConfigValidationResult,
  CronJobConfig,
  VitoConfig,
} from "../../src/contracts/vito-config.js";
import { SystemContentRouterService } from "../../src/routers/system-content/system-content-router.js";
import type { VitoService } from "../../src/services/vito/VitoService.js";

class TestVitoService implements VitoService {
  soul = "Original soul";
  readonly systemPrompt = "Static system prompt";
  readonly jobs: CronJobConfig[] = [];

  getConfig(_x: Context): VitoConfig {
    throw new Error("Not used");
  }

  saveConfig(_x: Context, _value: unknown): VitoConfig {
    throw new Error("Not used");
  }

  validateConfig(_x: Context, _value: unknown): ConfigValidationResult {
    return { valid: false, issues: [] };
  }

  getSoul(_x: Context): string {
    return this.soul;
  }

  saveSoul(_x: Context, soul: string): void {
    this.soul = soul;
  }

  getSystemPrompt(_x: Context): string {
    return this.systemPrompt;
  }

  getConfiguredJobs(_x: Context): CronJobConfig[] {
    return this.jobs;
  }
}

const service = new TestVitoService();
const x = new ObjectContext({ vitoService: () => service });
const app = express();
app.use(express.json());
app.use("/api", await new SystemContentRouterService().createRouter(x));

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

describe("system content router", () => {
  it("reads and validates updates to user-owned soul content", async () => {
    const initial = await fetch(`${baseUrl}/api/soul`);
    assert.deepEqual(await initial.json(), { content: "Original soul" });

    const invalid = await fetch(`${baseUrl}/api/soul`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: 42 }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(service.soul, "Original soul");

    const updated = await fetch(`${baseUrl}/api/soul`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Updated soul" }),
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(await updated.json(), { content: "Updated soul" });
    assert.equal(service.soul, "Updated soul");
  });

  it("exposes the project-owned system prompt as read-only", async () => {
    const read = await fetch(`${baseUrl}/api/system-prompt`);
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { content: "Static system prompt" });

    const write = await fetch(`${baseUrl}/api/system-prompt`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Replacement" }),
    });
    assert.equal(write.status, 405);
    assert.equal(write.headers.get("allow"), "GET");
    assert.deepEqual(await write.json(), { error: "System prompt is read-only" });
    assert.equal(service.systemPrompt, "Static system prompt");
  });

  it("preserves the configured jobs response", async () => {
    const response = await fetch(`${baseUrl}/api/jobs`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });
});
