import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { z } from "zod";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";
import { SecretRouterService } from "../../src/routers/SecretRouterService.js";
import { FileSecretService } from "../../src/services/secrets/FileSecretService.js";

const root = mkdtempSync(join(tmpdir(), "vito-secret-router-"));
const service = new FileSecretService();
const x = dashboardRouterContext({
  secretsPath: () => join(root, "secrets.json"),
  piAuthPath: () => join(root, "auth.json"),
  secretService: () => service,
});
const app = express();
app.use(express.json());
app.use("/api/secrets", await new SecretRouterService().createRouter(x));

const secretSchema = z.object({
  key: z.string(),
  value: z.string(),
  system: z.boolean(),
  description: z.string().optional(),
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
    server.close((error) => error ? reject(error) : resolve());
  });
  delete process.env.TEST_ROUTER_SECRET;
  rmSync(root, { recursive: true, force: true });
});

describe("secret router", () => {
  it("validates and saves secrets", async () => {
    const invalidResponse = await fetch(`${baseUrl}/api/secrets/invalid-key`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "test" }),
    });
    assert.equal(invalidResponse.status, 400);

    const response = await fetch(`${baseUrl}/api/secrets/TEST_ROUTER_SECRET`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "test" }),
    });
    assert.equal(response.status, 200);
    assert.equal(service.get(x, "TEST_ROUTER_SECRET"), "test");
    assert.equal(process.env.TEST_ROUTER_SECRET, "test");
  });

  it("lists system and custom secrets", async () => {
    const response = await fetch(`${baseUrl}/api/secrets`);
    assert.equal(response.status, 200);
    const entries = z.array(secretSchema).parse(await response.json());
    assert.ok(entries.some((entry) => entry.key === "TELEGRAM_BOT_TOKEN"));
    assert.ok(entries.some((entry) => entry.key === "TEST_ROUTER_SECRET"));
  });

  it("deletes custom secrets but protects system secrets", async () => {
    const systemResponse = await fetch(`${baseUrl}/api/secrets/DISCORD_BOT_TOKEN`, {
      method: "DELETE",
    });
    assert.equal(systemResponse.status, 400);

    const response = await fetch(`${baseUrl}/api/secrets/TEST_ROUTER_SECRET`, {
      method: "DELETE",
    });
    assert.equal(response.status, 204);
    assert.equal(service.get(x, "TEST_ROUTER_SECRET"), undefined);
  });
});
