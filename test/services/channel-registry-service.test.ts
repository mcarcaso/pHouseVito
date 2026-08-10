import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Context } from "../../src/context/Context.js";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import { xSessionStore } from "../../src/lib/x.js";
import type { ChannelService } from "../../src/services/channels/ChannelService.js";
import { DefaultChannelRegistryService } from "../../src/services/channels/DefaultChannelRegistryService.js";
import {
  ChannelManagementNotSupportedError,
  ChannelNotConfiguredError,
} from "../../src/services/channels/ChannelRegistryService.js";
import { SqliteSessionStore } from "../../src/stores/sessions/SqliteSessionStore.js";
import type { OutputHandler } from "../../src/lib/output/OutputHandler.js";
import type { InboundEvent } from "../../src/lib/types/inbound-event.js";
import type { SessionRow } from "../../src/stores/sessions/SessionStore.js";

function createManagedChannel(
  name: "discord" | "telegram",
  resolveAlias: (session: SessionRow) => string | undefined
): ChannelService {
  return {
    name,
    capabilities: { typing: true, reactions: false, attachments: true, streaming: false },
    management: {
      registerCommands: async () => ({ success: true, count: name === "discord" ? 5 : 4 }),
      resolveSessionAlias: async (_x, session) => resolveAlias(session),
    },
    start: async () => undefined,
    stop: async () => undefined,
    listen: async () => () => undefined,
    createOutputHandler: (_x: Context, _event: InboundEvent): OutputHandler => ({ relay: async () => undefined }),
  };
}

function createHarness() {
  const db = createDatabase(":memory:");
  const service = new DefaultChannelRegistryService();
  const x = new ObjectContext({
    db: () => db,
    sessionStore: () => new SqliteSessionStore(),
    channelRegistryService: () => service,
  });
  return { db, x, service };
}

function createSession(
  x: ObjectContext,
  args: { id: string; channel: string; target: string; alias?: string | null }
): void {
  xSessionStore(x).create(x, {
    id: args.id,
    channel: args.channel,
    channel_target: args.target,
    created_at: 1,
    last_active_at: 1,
    config: "{}",
    alias: args.alias ?? null,
  });
}

describe("DefaultChannelRegistryService", () => {
  it("rejects operations for unconfigured channels", async () => {
    const { db, x, service } = createHarness();
    try {
      await assert.rejects(() => service.registerCommands(x, "discord"), ChannelNotConfiguredError);
      await assert.rejects(() => service.generateAliases(x, "telegram"), ChannelNotConfiguredError);
    } finally {
      db.close();
    }
  });

  it("distinguishes unconfigured channels from unsupported management", async () => {
    const { db, x, service } = createHarness();
    try {
      const channel = createManagedChannel("discord", () => undefined);
      service.register(x, { ...channel, management: undefined });
      await assert.rejects(
        () => service.registerCommands(x, "discord"),
        ChannelManagementNotSupportedError
      );
    } finally {
      db.close();
    }
  });

  it("registers services and delegates management capabilities", async () => {
    const { db, x, service } = createHarness();
    try {
      createSession(x, { id: "discord:guild", channel: "discord", target: "guild" });
      createSession(x, { id: "discord:dm", channel: "discord", target: "dm" });
      createSession(x, { id: "discord:missing", channel: "discord", target: "missing" });
      createSession(x, {
        id: "discord:existing",
        channel: "discord",
        target: "existing",
        alias: "Existing",
      });
      service.register(x, createManagedChannel("discord", (session) => {
        if (session.channel_target === "guild") return "Server / general";
        if (session.channel_target === "dm") return "Direct Message";
        return undefined;
      }));

      assert.deepEqual(await service.registerCommands(x, "discord"), { success: true, count: 5 });
      const result = await service.generateAliases(x, "discord");
      assert.deepEqual(result.sessions, {
        updated: ["discord:dm", "discord:guild"],
        failed: ["discord:missing"],
      });
      const sessions = xSessionStore(x).list(x, { channels: ["discord"] });
      const aliases = new Map(sessions.map((session) => [session.id, session.alias]));
      assert.equal(aliases.get("discord:guild"), "Server / general");
      assert.equal(aliases.get("discord:dm"), "Direct Message");
      assert.equal(aliases.get("discord:existing"), "Existing");
    } finally {
      db.close();
    }
  });
});
