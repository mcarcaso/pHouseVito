import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express from "express";
import type { Context } from "../../src/context/Context.js";
import { dashboardRouterContext } from "../support/dashboard-router-context.js";
import {
  ChannelManagementRouterService,
  type ManagedChannelName,
} from "../../src/routers/ChannelManagementRouterService.js";
import type {
  AliasGenerationResult,
  ChannelRegistration,
  ChannelRegistryService,
} from "../../src/services/channels/ChannelRegistryService.js";
import { ChannelNotConfiguredError } from "../../src/services/channels/ChannelRegistryService.js";
import type { ChannelService, CommandRegistrationResult } from "../../src/services/channels/ChannelService.js";

class TestChannelRegistryService implements ChannelRegistryService {
  configured = new Set<ManagedChannelName>(["discord"]);

  register(_x: Context, channel: ChannelService): void {
    if (channel.name === "discord" || channel.name === "telegram") {
      this.configured.add(channel.name);
    }
  }

  get(_x: Context, _name: string): ChannelRegistration | undefined {
    return undefined;
  }

  list(_x: Context): ChannelRegistration[] {
    return [];
  }

  async registerCommands(
    _x: Context,
    channel: ManagedChannelName
  ): Promise<CommandRegistrationResult> {
    if (!this.configured.has(channel)) throw new ChannelNotConfiguredError(channel);
    return { success: true, count: channel === "discord" ? 5 : 4 };
  }

  async generateAliases(
    _x: Context,
    channel: ManagedChannelName
  ): Promise<AliasGenerationResult> {
    if (!this.configured.has(channel)) throw new ChannelNotConfiguredError(channel);
    return {
      success: true,
      updated: 1,
      failed: 1,
      sessions: {
        updated: [`${channel}:updated`],
        failed: [`${channel}:failed`],
      },
    };
  }
}

const service = new TestChannelRegistryService();
const x = dashboardRouterContext({ channelRegistryService: () => service });
const app = express();
app.use("/api/discord", await new ChannelManagementRouterService("discord").createRouter(x));
app.use("/api/telegram", await new ChannelManagementRouterService("telegram").createRouter(x));

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

describe("channel management router", () => {
  it("preserves unconfigured-channel errors", async () => {
    const response = await fetch(`${baseUrl}/api/telegram/register-commands`, { method: "POST" });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      success: false,
      error: "Telegram channel not configured",
    });
  });

  it("delegates command registration", async () => {
    const response = await fetch(`${baseUrl}/api/discord/register-commands`, { method: "POST" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, count: 5 });
  });

  it("preserves alias-generation response shape", async () => {
    const response = await fetch(`${baseUrl}/api/discord/auto-alias`, { method: "POST" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      updated: 1,
      failed: 1,
      sessions: {
        updated: ["discord:updated"],
        failed: ["discord:failed"],
      },
    });
  });
});
