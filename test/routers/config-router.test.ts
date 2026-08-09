import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { z } from "zod";
import { vitoConfigSchema } from "../../src/shared/contracts/vito-config.js";
import { RootContext } from "../../src/context/RootContext.js";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";
import { createDatabase } from "../../src/db/schema.js";
import { xVitoService } from "../../src/lib/x.js";
import { ConfigRouterService } from "../../src/routers/config/config-router.js";

const userDir = mkdtempSync(join(tmpdir(), "vito-config-router-"));
writeFileSync(
  join(userDir, "vito.config.json"),
  readFileSync(join(process.cwd(), "user.example", "vito.config.json"), "utf-8")
);
writeFileSync(join(userDir, "SOUL.md"), "test soul\n");

const db = createDatabase(":memory:");
const x = dashboardRouterContext({}, RootContext({
  db,
  userDir,
  skillsDir: join(userDir, "skills"),
}));
const app = express();
app.use(express.json());
app.use("/api", await new ConfigRouterService().createRouter(x));

const validationResponseSchema = z.object({
  error: z.string(),
  issues: z.array(z.object({ path: z.string() }).passthrough()),
});
const streamModeResponseSchema = z.object({
  streamMode: z.enum(["stream", "bundled", "final"]),
});
const defaultsResponseSchema = z.object({
  harness: z.string(),
  streamMode: z.enum(["stream", "bundled", "final"]),
}).passthrough();
const harnessesResponseSchema = z.object({
  default: z.string(),
  available: z.record(z.string(), z.unknown()),
  sessionOverrides: z.array(z.unknown()),
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
  db.close();
  rmSync(userDir, { recursive: true, force: true });
});

describe("config router", () => {
  it("returns validated config and defaults", async () => {
    const configResponse = await fetch(`${baseUrl}/api/config`);
    assert.equal(configResponse.status, 200);
    vitoConfigSchema.parse(await configResponse.json());

    const defaultsResponse = await fetch(`${baseUrl}/api/settings/defaults`);
    assert.equal(defaultsResponse.status, 200);
    const defaults = defaultsResponseSchema.parse(await defaultsResponse.json());
    assert.equal(defaults.harness, "pi-coding-agent");
    assert.equal(defaults.streamMode, "stream");

    const harnessesResponse = await fetch(`${baseUrl}/api/harnesses`);
    assert.equal(harnessesResponse.status, 200);
    const harnesses = harnessesResponseSchema.parse(await harnessesResponse.json());
    assert.equal("pi-coding-agent" in harnesses.available, true);
  });

  it("rejects invalid config patches with structured errors", async () => {
    const response = await fetch(`${baseUrl}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: { streamMode: "invalid" } }),
    });
    assert.equal(response.status, 400);
    const result = validationResponseSchema.parse(await response.json());
    assert.equal(result.issues[0]?.path, "body.settings.streamMode");
  });

  it("validates, merges, and atomically saves config patches", async () => {
    const response = await fetch(`${baseUrl}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bot: { name: "Test Vito" },
        settings: { streamMode: "bundled", timezone: "Europe/London" },
      }),
    });
    assert.equal(response.status, 200);
    const config = vitoConfigSchema.parse(await response.json());
    assert.equal(config.bot?.name, "Test Vito");
    assert.equal(config.settings.streamMode, "bundled");
    assert.equal(config.settings.timezone, "Europe/London");
    assert.equal(config.settings.harness, "pi-coding-agent");

    const persisted = xVitoService(x).getConfig(x);
    assert.equal(persisted.bot?.name, "Test Vito");
  });

  it("validates and persists channel stream mode", async () => {
    const invalidResponse = await fetch(`${baseUrl}/api/channels/dashboard/stream-mode`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ streamMode: "invalid" }),
    });
    assert.equal(invalidResponse.status, 400);

    const response = await fetch(`${baseUrl}/api/channels/dashboard/stream-mode`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ streamMode: "final" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(
      streamModeResponseSchema.parse(await response.json()),
      { streamMode: "final" }
    );

    const getResponse = await fetch(`${baseUrl}/api/channels/dashboard/stream-mode`);
    assert.equal(getResponse.status, 200);
    assert.equal(
      streamModeResponseSchema.parse(await getResponse.json()).streamMode,
      "final"
    );
    assert.equal(
      xVitoService(x).getConfig(x).channels.dashboard?.streamMode,
      "final"
    );
  });
});
