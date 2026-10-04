import assert from "node:assert/strict";
import { test } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import { DefaultSessionService } from "../../src/services/sessions/DefaultSessionService.js";
import { SqliteSessionStore } from "../../src/stores/sessions/SqliteSessionStore.js";
import { SqliteMessageStore } from "../../src/stores/messages/SqliteMessageStore.js";
import {
  captureSilentInbound,
  backgroundPage,
  backgroundPrompt,
  advanceBackgroundCursor,
  canInvoke,
  speakerAllowed,
  backgroundHistoryTool,
  activeBackgroundBounds,
} from "../../src/services/channels/passive-memory.js";
import type { InboundEvent } from "../../src/lib/types/inbound-event.js";
import type { VitoConfig } from "../../src/shared/schemas/vito-config.js";

function setup(channel = "discord") {
  const db = createDatabase(":memory:");
  const config: VitoConfig = {
    settings: { requireMention: true, passiveMemory: true },
    channels: { [channel]: { enabled: true, allowedUserIds: ["boss"] } },
    cron: { jobs: [] },
  };
  const checks: unknown[] = [];
  const store = new SqliteMessageStore();
  const x = new ObjectContext({
    db: () => db,
    sessionStore: () => new SqliteSessionStore(),
    sessionService: () => new DefaultSessionService(),
    vitoService: () => ({ getConfig: () => config }),
    messageStore: () => ({
      ...store,
      create: store.create.bind(store),
      list: store.list.bind(store),
      cmd: (_x: unknown, c: unknown) => checks.push(c),
    }),
  });
  const event = (n: number, extra: Partial<InboundEvent> = {}): InboundEvent => ({
    sessionKey: `${channel}:room`,
    channel,
    target: "room",
    author: "Alice",
    authorId: "alice",
    messageId: String(n),
    timestamp: n * 1000,
    content: `message ${n}`,
    hasMention: false,
    raw: {},
    ...extra,
  });
  return { db, config, checks, x, event, store };
}

for (const channel of ["discord", "slack", "telegram"]) {
  test(`${channel}: passive capture does not grant invocation; exact last-five count and dedup`, () => {
    const { db, x, event, checks } = setup(channel);
    try {
      for (let n = 1; n <= 8; n++) assert.equal(captureSilentInbound(x, event(n)), true);
      captureSilentInbound(x, event(8));
      assert.equal(backgroundPage(x, event(9).sessionKey, 9000).total, 8);
      const page = backgroundPage(x, event(9).sessionKey, 9000);
      assert.equal(page.messages.length, 5);
      assert.deepEqual(
        page.messages.map((m) => m.timestamp),
        [4000, 5000, 6000, 7000, 8000],
      );
      assert.match(backgroundPrompt(x, event(9))!, /3 earlier captured messages omitted/);
      assert.equal(canInvoke(x, event(9, { hasMention: true })), false);
      assert.equal(
        captureSilentInbound(x, event(9, { authorId: "boss", hasMention: true })),
        false,
      );
      assert.ok(checks.length);
      assert.equal(page.messages[0].author, "Alice (alice)");
    } finally {
      db.close();
    }
  });
}

test("default off, bot exclusion, missing identity, denied commands, speaker selection", () => {
  const { db, config, x, event } = setup();
  try {
    config.settings.passiveMemory = false;
    assert.equal(captureSilentInbound(x, event(1)), true);
    config.settings.passiveMemory = true;
    captureSilentInbound(x, event(2, { authorIsBot: true }));
    captureSilentInbound(x, event(3, { authorId: undefined }));
    config.settings.rememberUserIds = ["boss"];
    captureSilentInbound(x, event(4));
    assert.equal(backgroundPage(x, "discord:room", 10000).total, 0);
    config.settings.rememberUserIds = "everyone";
    assert.equal(
      captureSilentInbound(x, event(5, { content: "/restart", hasMention: true })),
      true,
    );
    assert.equal(backgroundPage(x, "discord:room", 10000).total, 1);
    assert.equal(captureSilentInbound(x, event(6, { authorId: "boss", content: "/stop" })), false);
    config.settings.rememberUserIds = "nobody";
    assert.equal(backgroundPage(x, "discord:room", 10000).total, 0);
  } finally {
    db.close();
  }
});

test("cursor advances only explicitly, trigger boundary excludes later chatter, seed excludes passive", () => {
  const { db, x, event, store } = setup();
  try {
    for (let n = 1; n <= 8; n++) captureSilentInbound(x, event(n));
    const trigger = event(6, { authorId: "boss", hasMention: true });
    assert.equal(backgroundPage(x, trigger.sessionKey, trigger.timestamp).total, 5);
    advanceBackgroundCursor(x, trigger);
    assert.match(backgroundPrompt(x, event(10))!, /0 earlier captured messages omitted/);
    assert.equal(
      store.list(x, { sessionIds: [trigger.sessionKey], excludePassive: true }).length,
      0,
    );
    advanceBackgroundCursor(x, event(2));
    assert.equal(
      (db.prepare("SELECT through_timestamp AS ts FROM passive_cursors").get() as { ts: number })
        .ts,
      6000,
    );
  } finally {
    db.close();
  }
});

test("history tool is scoped, bounded by the active trigger and rechecks speaker permissions", async () => {
  const { db, config, x, event } = setup();
  const sid = event(1).sessionKey;
  try {
    for (let n = 1; n <= 8; n++) captureSilentInbound(x, event(n));
    captureSilentInbound(x, event(9, { sessionKey: "discord:other" }));
    activeBackgroundBounds.set(sid, 6000);
    const tool = backgroundHistoryTool(x, sid);
    const output = await tool.execute("test", { limit: 20 }, undefined, undefined, {} as never);
    const data = JSON.parse((output.content[0] as { text: string }).text);
    assert.equal(data.total, 5);
    config.settings.rememberUserIds = "nobody";
    const denied = await tool.execute("test", {}, undefined, undefined, {} as never);
    assert.equal(JSON.parse((denied.content[0] as { text: string }).text).total, 0);
  } finally {
    activeBackgroundBounds.delete(sid);
    db.close();
  }
});

test("speaker selectors are fail-closed and invocation overrides inherit independently", () => {
  assert.equal(speakerAllowed([], "boss"), false);
  assert.equal(speakerAllowed(["boss"], undefined), false);
  const { db, config, x, event } = setup();
  try {
    config.settings.invokeUserIds = "nobody";
    assert.equal(canInvoke(x, event(1, { authorId: "boss" })), false);
    config.sessions = { "discord:room": { invokeUserIds: ["alice"], rememberUserIds: "nobody" } };
    assert.equal(canInvoke(x, event(1)), true);
    assert.equal(captureSilentInbound(x, event(1)), true);
    assert.equal(backgroundPage(x, "discord:room", 9000).total, 0);
  } finally {
    db.close();
  }
});
