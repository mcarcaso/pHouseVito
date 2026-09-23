import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Client } from "discord.js";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import {
  DiscordOutputHandler,
  splitMessage,
} from "../../src/services/channels/discord/DiscordOutputHandler.js";
import { SqliteDiscordQueueStore } from "../../src/stores/discord/SqliteDiscordQueueStore.js";
import type { DurableDiscordEvent } from "../../src/stores/discord/DiscordQueueStore.js";

function durable(id: string): DurableDiscordEvent {
  return {
    id,
    channel: "channel-1",
    transportChannel: "channel-1",
    target: "channel-1",
    sessionKey: "discord:channel-1",
    author: "Mike",
    authorId: "owner",
    timestamp: 1,
    content: "hello",
    hasMention: true,
    commandAuthorized: true,
    attachments: [],
  };
}

describe("Discord durability", () => {
  it("claims ordered input once and never replays an interrupted active turn", () => {
    const db = createDatabase(":memory:");
    const x = new ObjectContext({ db: () => db });
    const store = new SqliteDiscordQueueStore();
    assert.equal(store.record(x, durable("10")), true);
    assert.equal(store.record(x, durable("9")), true);
    assert.equal(store.record(x, durable("9")), false);
    assert.equal(store.claim(x, "channel-1")?.id, "9");
    assert.equal(store.claim(x, "channel-1"), undefined);
    assert.equal(store.recover(x), 1);
    assert.equal(store.claim(x, "channel-1")?.id, "10");
    store.complete(x, "10");
    assert.equal(store.record(x, durable("10")), false);
    assert.equal(store.record(x, durable("8")), false);
    assert.deepEqual(store.counts(x), { pending: 0, active: 0, interrupted: 1 });
    db.close();
  });

  it("atomically consumes a queued message accepted as steering", () => {
    const db = createDatabase(":memory:");
    const x = new ObjectContext({ db: () => db });
    const store = new SqliteDiscordQueueStore();
    const event = durable("12");
    assert.equal(store.record(x, event), true);
    assert.deepEqual(store.pending(x, "12"), event);
    assert.equal(store.consumePending(x, "12"), true);
    assert.equal(store.pending(x, "12"), undefined);
    assert.equal(store.consumePending(x, "12"), false);
    assert.equal(store.claim(x, "channel-1"), undefined);
    db.close();
  });

  it("resumes nonce-backed delivery receipts from the exact piece", () => {
    const db = createDatabase(":memory:");
    const x = new ObjectContext({ db: () => db });
    const store = new SqliteDiscordQueueStore();
    store.createDelivery(x, "delivery", "fingerprint");
    store.advanceDelivery(x, "delivery", 2);
    assert.equal(store.recover(x), 1);
    assert.deepEqual(store.delivery(x, "delivery"), {
      id: "delivery",
      fingerprint: "fingerprint",
      status: "pending",
      nextPiece: 2,
    });
    db.close();
  });

  it("presents provider summaries and tool work in one quiet progress message", async () => {
    const db = createDatabase(":memory:");
    const store = new SqliteDiscordQueueStore();
    const x = new ObjectContext({
      db: () => db,
      discordQueueStore: () => store,
      vitoService: () => ({ getConfig: () => ({ apps: { baseDomain: "example.com" } }) }),
    });
    const sent: Array<Record<string, unknown>> = [];
    let deleted = 0;
    const channel = {
      id: "channel-1",
      send: async (value: Record<string, unknown>) => {
        sent.push(value);
        return {
          async edit(content: string) {
            sent.push({ edited: content });
          },
          async delete() {
            deleted++;
          },
        };
      },
    };
    const client = {
      channels: { fetch: async () => channel },
      users: { fetch: async () => ({ createDM: async () => channel }) },
    } as unknown as Client;
    const event = {
      sessionKey: "discord:channel-1",
      channel: "discord",
      target: "channel-1",
      author: "Mike",
      timestamp: 2,
      content: "",
      raw: { source: "discord", discordMessageId: "message-progress" },
    };
    try {
      const handler = new DiscordOutputHandler(x, client, event);
      await handler.relayEvent({
        kind: "thinking",
        activity: "thinking",
        content: "**Inspecting current output**",
      });
      assert.equal(sent.length, 1);
      assert.match(String(sent[0].content), /^⏳ \*\*Inspecting current output\*\*/);
      assert.equal(sent[0].flags, 4_096);
      assert.match(String(sent[0].content), /https:\/\/example\.com\/chat\//);

      await handler.relayEvent({
        kind: "tool_start",
        activity: "reading",
        toolName: "read",
        toolCallId: "read-1",
      });
      await new Promise((resolve) => setTimeout(resolve, 2_100));

      assert.equal(sent.length, 2);
      const progress = String(sent[1].edited);
      assert.match(progress, /Reading/);
      assert.match(progress, /1 tool/);
      assert.match(progress, /◌ Read file…/);

      await handler.relay("Done.");
      await handler.endMessage();
      assert.equal(deleted, 1);
      assert.equal((sent[2] as { content: string }).content, "Done.");
    } finally {
      db.close();
    }
  });

  it("splits bounded fenced messages and sends each attachment path exactly once", async () => {
    const chunks = splitMessage(`\`\`\`ts\n${"const value = 1;\n".repeat(180)}\`\`\``);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => chunk.length <= 2_000));
    assert.ok(chunks.every((chunk) => (chunk.match(/```/g)?.length ?? 0) % 2 === 0));

    const root = mkdtempSync(join(tmpdir(), "vito-discord-"));
    const file = join(root, "report with spaces.txt");
    writeFileSync(file, "report");
    const db = createDatabase(":memory:");
    const store = new SqliteDiscordQueueStore();
    const x = new ObjectContext({ db: () => db, discordQueueStore: () => store });
    const sent: unknown[] = [];
    const channel = {
      id: "channel-1",
      send: async (value: unknown) => {
        sent.push(value);
        return {};
      },
    };
    const client = {
      channels: { fetch: async () => channel },
      users: { fetch: async () => ({ createDM: async () => channel }) },
    } as unknown as Client;
    const event = {
      sessionKey: "discord:channel-1",
      channel: "discord",
      target: "channel-1",
      author: "Mike",
      timestamp: 1,
      content: "",
      raw: { source: "discord", discordMessageId: "message-1" },
    };
    try {
      const first = new DiscordOutputHandler(x, client, event);
      await first.relay(`Summary\nMEDIA:${file}`);
      await first.endMessage();
      assert.equal(sent.length, 2);
      assert.deepEqual((sent[0] as { content: string }).content, "Summary");
      assert.deepEqual((sent[1] as { files: string[] }).files, [file]);
      assert.equal(typeof (sent[0] as { nonce: unknown }).nonce, "string");
      assert.equal((sent[0] as { enforceNonce: boolean }).enforceNonce, true);

      const retry = new DiscordOutputHandler(x, client, event);
      await retry.relay(`Summary\nMEDIA:${file}`);
      await retry.endMessage();
      assert.equal(sent.length, 2);
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
