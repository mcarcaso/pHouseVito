import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { createDatabase } from "../../src/db/schema.js";
import { xSessionStore } from "../../src/lib/x.js";
import { DefaultChannelManagementService } from "../../src/services/channels/DefaultChannelManagementService.js";
import { ChannelNotConfiguredError } from "../../src/services/channels/ChannelManagementService.js";
import { SqliteSessionStore } from "../../src/stores/sessions/SqliteSessionStore.js";

function createHarness() {
  const db = createDatabase(":memory:");
  const service = new DefaultChannelManagementService();
  const x = new ObjectContext({
    db: () => db,
    sessionStore: () => new SqliteSessionStore(),
    channelManagementService: () => service,
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

describe("DefaultChannelManagementService", () => {
  it("rejects operations for unconfigured channels", async () => {
    const { db, x, service } = createHarness();
    try {
      await assert.rejects(
        () => service.registerCommands(x, "discord"),
        ChannelNotConfiguredError
      );
      await assert.rejects(
        () => service.generateAliases(x, "telegram"),
        ChannelNotConfiguredError
      );
    } finally {
      db.close();
    }
  });

  it("registers commands and generates Discord aliases", async () => {
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
      service.configure(x, {
        channel: "discord",
        adapter: {
          registerSlashCommands: async () => ({ success: true, count: 5 }),
          getChannelInfo: async (id) => id === "guild"
            ? { name: "general", guildName: "Server" }
            : id === "dm"
              ? { name: "Direct Message" }
              : null,
        },
      });

      assert.deepEqual(await service.registerCommands(x, "discord"), {
        success: true,
        count: 5,
      });
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

  it("preserves Telegram DM, group, and topic alias formats", async () => {
    const { db, x, service } = createHarness();
    try {
      createSession(x, { id: "telegram:private", channel: "telegram", target: "private" });
      createSession(x, { id: "telegram:group", channel: "telegram", target: "group" });
      createSession(x, { id: "telegram:forum:42", channel: "telegram", target: "forum" });
      createSession(x, { id: "telegram:missing", channel: "telegram", target: "missing" });
      service.configure(x, {
        channel: "telegram",
        adapter: {
          setMyCommands: async () => ({ success: true, count: 4 }),
          getChatInfo: async (id) => id === "private"
            ? { name: "Mike", type: "private" }
            : id === "group"
              ? { name: "Group", type: "group" }
              : id === "forum"
                ? { name: "Forum", type: "supergroup" }
                : null,
        },
      });

      const result = await service.generateAliases(x, "telegram");
      assert.equal(result.updated, 3);
      assert.equal(result.failed, 1);
      const sessions = xSessionStore(x).list(x, { channels: ["telegram"] });
      const aliases = new Map(sessions.map((session) => [session.id, session.alias]));
      assert.equal(aliases.get("telegram:private"), "telegram: DM: Mike");
      assert.equal(aliases.get("telegram:group"), "telegram: Group");
      assert.equal(aliases.get("telegram:forum:42"), "telegram: Forum / Topic");
    } finally {
      db.close();
    }
  });
});
