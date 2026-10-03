import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { z } from "zod";
import { vitoConfigSchema } from "../../src/shared/schemas/vito-config.js";
import { RootContext } from "../../src/context/RootContext.js";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import { xVitoService } from "../../src/lib/x.js";
import { ConfigRouterService } from "../../src/routers/ConfigRouterService.js";

const userDir = mkdtempSync(join(tmpdir(), "vito-config-router-"));
writeFileSync(
  join(userDir, "vito.config.json"),
  readFileSync(join(process.cwd(), "user.example", "vito.config.json"), "utf-8"),
);
writeFileSync(join(userDir, "SOUL.md"), "test soul\n");

const db = createDatabase(":memory:");
const secretValues = new Map<string, string>();
const x = dashboardRouterContext(
  { secretService: () => ({ get: (_x: unknown, key: string) => secretValues.get(key) }) },
  RootContext({
    db,
    userDir,
    skillsDir: join(userDir, "skills"),
  }),
);
const app = express();
app.use("/api", await new ConfigRouterService().createRouter(x));

const validationResponseSchema = z.object({
  error: z.string(),
  issues: z.array(z.object({ path: z.string() }).passthrough()),
});
const defaultsResponseSchema = z
  .object({
    traceMessageUpdates: z.boolean(),
  })
  .passthrough();

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
  db.close();
  rmSync(userDir, { recursive: true, force: true });
});

describe("config router", () => {
  it("lists all supported channels, including absent config, without secret values", async () => {
    const response = await fetch(`${baseUrl}/api/channels/setup`);
    assert.equal(response.status, 200);
    const statuses = (await response.json()) as Array<{
      name: string;
      enabled: boolean;
      missingSecrets: string[];
      requiredSecrets: string[];
    }>;
    assert.deepEqual(
      statuses.map((item) => item.name),
      ["dashboard", "discord", "slack", "telegram", "whatsapp"],
    );
    assert.deepEqual(statuses.find((item) => item.name === "dashboard")?.requiredSecrets, []);
    assert.deepEqual(statuses.find((item) => item.name === "slack")?.requiredSecrets, [
      "SLACK_BOT_TOKEN",
      "SLACK_APP_TOKEN",
    ]);
    assert.deepEqual(statuses.find((item) => item.name === "slack")?.missingSecrets, [
      "SLACK_BOT_TOKEN",
      "SLACK_APP_TOKEN",
    ]);
    assert.equal(statuses.find((item) => item.name === "whatsapp")?.enabled, false);
    assert.deepEqual(statuses.find((item) => item.name === "whatsapp")?.missingSecrets, [
      "WHATSAPP_AGENT_API_KEY",
    ]);
  });

  it("rejects enabling without required secrets, but allows disable and tracks restart need", async () => {
    const update = (enabled: boolean) =>
      fetch(`${baseUrl}/api/config`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channels: { discord: { enabled } } }),
      });
    secretValues.set("DISCORD_BOT_TOKEN", "  ");
    const rejected = await update(true);
    assert.equal(rejected.status, 400);
    assert.match(((await rejected.json()) as { error: string }).error, /DISCORD_BOT_TOKEN/);
    assert.equal(xVitoService(x).getConfig(x).channels.discord?.enabled, false);
    secretValues.set("DISCORD_BOT_TOKEN", "test-secret-never-exposed");
    assert.equal((await update(true)).status, 200);
    const response = await fetch(`${baseUrl}/api/channels/setup`);
    const text = await response.text();
    assert.ok(!text.includes("test-secret-never-exposed"));
    const statuses = JSON.parse(text) as Array<{
      name: string;
      restartRequired: boolean;
      missingSecrets: string[];
      startupEnabled: boolean;
    }>;
    const discord = statuses.find((item) => item.name === "discord");
    assert.equal(discord?.restartRequired, true);
    assert.equal(discord?.startupEnabled, false);
    assert.deepEqual(discord?.missingSecrets, []);
    secretValues.delete("DISCORD_BOT_TOKEN");
    assert.equal((await update(false)).status, 200);
    const reverted = (await (await fetch(`${baseUrl}/api/channels/setup`)).json()) as Array<{
      name: string;
      restartRequired: boolean;
    }>;
    assert.equal(reverted.find((item) => item.name === "discord")?.restartRequired, false);
  });

  it("allows a zero-secret channel to be enabled without credentials", async () => {
    for (const enabled of [false, true]) {
      const response = await fetch(`${baseUrl}/api/config`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channels: { dashboard: { enabled } } }),
      });
      assert.equal(response.status, 200);
    }
  });

  it("returns validated config and defaults", async () => {
    const configResponse = await fetch(`${baseUrl}/api/config`);
    assert.equal(configResponse.status, 200);
    vitoConfigSchema.parse(await configResponse.json());

    const defaultsResponse = await fetch(`${baseUrl}/api/settings/defaults`);
    assert.equal(defaultsResponse.status, 200);
    const defaults = defaultsResponseSchema.parse(await defaultsResponse.json());
    assert.equal(defaults.traceMessageUpdates, false);
  });

  it("rejects the retired stream mode setting", async () => {
    const response = await fetch(`${baseUrl}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: { streamMode: "final" } }),
    });
    assert.equal(response.status, 400);
    const result = validationResponseSchema.parse(await response.json());
    assert.equal(result.issues[0]?.path, "body.settings");
  });

  it("validates, merges, and atomically saves config patches", async () => {
    const response = await fetch(`${baseUrl}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bot: { name: "Test Vito" },
        settings: { timezone: "Europe/London" },
      }),
    });
    assert.equal(response.status, 200);
    const config = vitoConfigSchema.parse(await response.json());
    assert.equal(config.bot?.name, "Test Vito");
    assert.equal(config.settings.timezone, "Europe/London");

    const persisted = xVitoService(x).getConfig(x);
    assert.equal(persisted.bot?.name, "Test Vito");
  });
});
