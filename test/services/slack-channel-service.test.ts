import assert from "node:assert/strict";
import { test } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import type { InboundEvent } from "../../src/lib/types/inbound-event.js";
import {
  SlackChannelService,
  type SlackEnvelope,
  type SlackSocketClient,
} from "../../src/services/channels/slack/SlackChannelService.js";
import { mockSlackClient } from "../helpers/slack-client.js";
import { SqliteSlackQueueStore } from "../../src/stores/slack/SqliteSlackQueueStore.js";
import { vitoConfigSchema } from "../../src/shared/schemas/vito-config.js";

class Socket implements SlackSocketClient {
  private handler?: (event: SlackEnvelope) => void;
  started = false;
  on(_name: string, handler: (event: SlackEnvelope) => void) {
    this.handler = handler;
  }
  off(_name: string, _handler: (event: SlackEnvelope) => void) {
    this.handler = undefined;
  }
  async start() {
    this.started = true;
  }
  async disconnect() {
    this.started = false;
  }
  async emit(type: string, body: unknown, onAck = () => {}) {
    await new Promise<void>((resolve) =>
      this.handler?.({
        type,
        body,
        ack: async () => {
          onAck();
          resolve();
        },
      }),
    );
  }
}

async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(predicate(), "Timed out waiting for Slack operation");
}

function incoming(ts: string, text: string, overrides: Record<string, unknown> = {}) {
  return {
    team_id: "T123",
    event: { type: "message", channel: "C123", user: "UOWNER", ts, text, ...overrides },
  };
}

async function fixture(handler?: (event: InboundEvent) => Promise<void>, fetcher?: typeof fetch) {
  const db = createDatabase(":memory:");
  const store = new SqliteSlackQueueStore();
  const socket = new Socket();
  const web = mockSlackClient();
  const config = vitoConfigSchema.parse({
    channels: {
      slack: { enabled: true, ownerIds: ["UOWNER"], settings: { requireMention: true } },
    },
    settings: {},
    cron: { jobs: [] },
  });
  const events: InboundEvent[] = [];
  const steered: InboundEvent[] = [];
  const files: Array<{ path: string; content: Buffer }> = [];
  const steering = { accept: true };
  const x = new ObjectContext({
    db: () => db,
    slackQueueStore: () => store,
    secretService: () => ({
      get: (_x: unknown, key: string) =>
        ({ SLACK_BOT_TOKEN: "test-bot-token", SLACK_APP_TOKEN: "test-app-token" })[
          key as "SLACK_BOT_TOKEN"
        ],
    }),
    vitoService: () => ({ getConfig: () => config }),
    orchestratorService: () => ({
      steer: async (_x: unknown, event: InboundEvent) => {
        steered.push(event);
        return steering.accept;
      },
    }),
    driveDir: () => "/tmp/vito-slack-test-drive",
    driveStore: () => ({
      create: (_x: unknown, args: { path: string; content: Buffer }) => {
        files.push(args);
        return { path: args.path };
      },
    }),
  });
  const channel = new SlackChannelService({
    createWebClient: () => web.client,
    createSocketClient: () => socket,
    fetch: fetcher,
  });
  await channel.start(x);
  await channel.listen(x, async (event) => {
    events.push(event);
    await handler?.(event);
  });
  return {
    db,
    store,
    socket,
    web,
    config,
    events,
    steered,
    files,
    steering,
    x,
    channel,
    close: async () => {
      await channel.stop(x);
      db.close();
    },
  };
}

test("Slack records before acknowledging and deduplicates message/app_mention retries", async () => {
  const f = await fixture();
  try {
    const body = incoming("1710000000.000001", "<@UBOT> hello");
    await f.socket.emit("events_api", body, () => {
      assert.ok(f.store.pending(f.x, "T123:C123:1710000000.000001"));
    });
    await f.socket.emit("events_api", { ...body, event: { ...body.event, type: "app_mention" } });
    await until(() => f.events.length === 1 && f.store.counts(f.x).active === 0);
    assert.equal(f.events[0].content, "hello");
    assert.equal(f.events[0].sessionKey, "slack:T123:C123");
    assert.equal(f.events[0].replyTo, "1710000000.000001");
    assert.equal((f.events[0].raw as Record<string, unknown>).commandAuthorized, true);
  } finally {
    await f.close();
  }
});

test("Slack rejects bots/system events and honors mention, DM and live allowlists", async () => {
  const f = await fixture();
  try {
    for (const overrides of [
      { bot_id: "BOTHER" },
      { subtype: "message_changed" },
      { subtype: "channel_join" },
      { user: "UBOT" },
    ]) {
      await f.socket.emit(
        "events_api",
        incoming("1710000000.000001", "<@UBOT> ignored", overrides),
      );
    }
    await f.socket.emit("events_api", incoming("1710000000.000002", "not mentioned"));
    await f.socket.emit("events_api", incoming("1710000000.000003", "DM", { channel: "D123" }));
    await until(() => f.events.length === 1);
    f.config.channels.slack!.allowDms = false;
    f.config.channels.slack!.allowedChannelIds = ["COTHER"];
    await f.socket.emit("events_api", incoming("1710000000.000004", "DM", { channel: "D123" }));
    await f.socket.emit("events_api", incoming("1710000000.000005", "<@UBOT> ignored"));
    f.config.channels.slack!.allowedChannelIds = [];
    f.config.channels.slack!.allowedUserIds = ["UOTHER"];
    await f.socket.emit("events_api", incoming("1710000000.000006", "<@UBOT> ignored"));
    f.config.channels.slack!.allowedUserIds = [];
    f.config.channels.slack!.allowedWorkspaceIds = ["TOTHER"];
    await f.socket.emit("events_api", incoming("1710000000.000007", "<@UBOT> ignored"));
    assert.equal(f.events.length, 1);
  } finally {
    await f.close();
  }
});

test("Slack processes independent threads concurrently and consumes sender-authorized steering once", async () => {
  let release!: () => void;
  const active = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(async (event) => {
    if (event.content === "first") await active;
  });
  try {
    await f.socket.emit(
      "events_api",
      incoming("1710000000.000001", "<@UBOT> first", { thread_ts: "1709999999.000001" }),
    );
    await until(() => f.events.length === 1);
    await f.socket.emit(
      "events_api",
      incoming("1710000000.000002", "<@UBOT> second", { thread_ts: "1709999999.000001" }),
    );
    await until(() => f.web.posts.some((post) => post.blocks));
    await f.socket.emit(
      "events_api",
      incoming("1710000000.000003", "<@UBOT> another thread", { thread_ts: "1709999999.000002" }),
    );
    await until(() => f.events.length === 2);
    const body = {
      type: "block_actions",
      team: { id: "T123" },
      user: { id: "UOTHER" },
      channel: { id: "C123" },
      message: { ts: "1710000100.000001", thread_ts: "1709999999.000001" },
      actions: [{ action_id: "vito_steer", value: "T123:C123:1710000000.000002" }],
    };
    await f.socket.emit("interactive", body);
    await until(() => f.web.ephemerals.length === 1);
    assert.equal(f.steered.length, 0);
    await f.socket.emit("interactive", {
      ...body,
      user: { id: "UOWNER" },
      message: { ...body.message, thread_ts: "1709999999.000002" },
    });
    await until(() => f.web.ephemerals.length === 2);
    assert.equal(f.steered.length, 0);
    await f.socket.emit("interactive", { ...body, user: { id: "UOWNER" } });
    await until(() => f.steered.length === 1 && f.web.ephemerals.length === 3);
    assert.equal(f.store.pending(f.x, "T123:C123:1710000000.000002"), undefined);
    release();
    await until(() => f.store.counts(f.x).active === 0);
    assert.deepEqual(
      f.events.map((e) => e.content),
      ["first", "another thread"],
    );
    assert.equal(f.steered[0].sessionKey, "slack:T123:C123:1709999999.000001");
  } finally {
    release();
    await f.close();
  }
});

test("Slack stop bypasses the active queue and clears pending input; slash commands carry owner authorization", async () => {
  let release!: () => void;
  const active = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(async (event) => {
    if (event.content === "first") await active;
  });
  try {
    await f.socket.emit("events_api", incoming("1710000000.000001", "<@UBOT> first"));
    await f.socket.emit("events_api", incoming("1710000000.000002", "<@UBOT> queued"));
    await f.socket.emit("events_api", incoming("1710000000.000003", "/stop"));
    await until(() => f.events.some((event) => event.content === "/stop"));
    assert.equal(f.store.counts(f.x).pending, 0);
    const stop = f.events.find((event) => event.content === "/stop")!;
    assert.equal((stop.raw as Record<string, unknown>).slackDiscarded, 1);
    await f.socket.emit("slash_commands", {
      command: "/vito",
      text: "restart",
      team_id: "T123",
      channel_id: "C123",
      user_id: "UOTHER",
      trigger_id: "unique-trigger",
    });
    await until(() => f.events.some((event) => event.content === "/restart"));
    assert.equal(
      (f.events.find((event) => event.content === "/restart")!.raw as Record<string, unknown>)
        .commandAuthorized,
      false,
    );
    release();
    await until(() => f.store.counts(f.x).active === 0);
    assert.ok(!f.events.some((event) => event.content === "queued"));
  } finally {
    release();
    await f.close();
  }
});

test("Slack authenticates private file downloads and refuses to send tokens to another host", async () => {
  let downloads = 0;
  const fetcher = (async (url: URL, init: RequestInit) => {
    assert.equal(url.hostname, "files.slack.com");
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer test-bot-token");
    assert.equal(init.redirect, "error");
    downloads++;
    return new Response("file bytes");
  }) as typeof fetch;
  const f = await fixture(undefined, fetcher);
  try {
    await f.socket.emit(
      "events_api",
      incoming("1710000000.000001", "<@UBOT> read this", {
        subtype: "file_share",
        files: [
          {
            id: "F123",
            name: "notes.txt",
            mimetype: "text/plain",
            url_private_download: "https://files.slack.com/files-pri/T123-F123/notes.txt",
          },
        ],
      }),
    );
    await until(() => f.events.length === 1);
    assert.equal(downloads, 1);
    assert.equal(f.files[0].content.toString(), "file bytes");
    assert.match(f.events[0].attachments![0].path!, /slack-.*-notes.txt$/);
    await f.socket.emit(
      "events_api",
      incoming("1710000000.000002", "<@UBOT> bad file", {
        files: [{ id: "F999", url_private: "https://example.com/secret" }],
      }),
    );
    await until(() => f.store.counts(f.x).interrupted === 1);
    assert.equal(downloads, 1);
    assert.equal(f.events.length, 1);
  } finally {
    await f.close();
  }
});

test("Slack inbox recovers pending work without replaying active/steering turns, and never resurrects stopped steering", () => {
  const db = createDatabase(":memory:");
  const x = new ObjectContext({ db: () => db });
  const store = new SqliteSlackQueueStore();
  const item = (id: string) => ({
    id,
    authorId: "UOWNER",
    event: {
      channel: "slack",
      target: "T123:C123",
      sessionKey: "slack:T123:C123",
      author: "UOWNER",
      content: id,
      timestamp: 1,
      raw: {},
    },
  });
  try {
    store.record(x, item("first"));
    store.record(x, item("second"));
    store.record(x, item("third"));
    assert.equal(store.claim(x, "T123:C123")!.id, "first");
    assert.equal(store.reserveSteering(x, "second"), true);
    assert.equal(store.recover(x), 2);
    assert.equal(store.claim(x, "T123:C123")!.id, "third");
    store.finish(x, "third");
    assert.equal(store.record(x, item("first")), false);
    store.record(x, item("fourth"));
    assert.equal(store.reserveSteering(x, "fourth"), true);
    assert.equal(store.claim(x, "T123:C123"), undefined);
    assert.equal(store.discardPending(x, "T123:C123"), 1);
    assert.equal(store.finishSteering(x, "fourth", false), false);
    assert.equal(store.claim(x, "T123:C123"), undefined);
  } finally {
    db.close();
  }
});

test("Slack supplies a quoted thread root without requesting bot-inaccessible thread history", async () => {
  const f = await fixture();
  try {
    f.web.client.conversations.history = async (args) => {
      assert.equal(args.oldest, "1709999999.000001");
      assert.equal(args.latest, "1709999999.000001");
      assert.equal(args.inclusive, true);
      return {
        ok: true,
        messages: [{ user: "UOWNER", text: "Original request", ts: "1709999999.000001" }],
      };
    };
    const event: InboundEvent = {
      channel: "slack",
      target: "T123:C123:1709999999.000001",
      sessionKey: "slack:T123:C123:1709999999.000001",
      author: "UOWNER",
      timestamp: 1,
      content: "follow up",
      replyTo: "1710000000.000001",
      raw: {},
    };
    const context = await f.channel.gatherMentionContext(f.x, event);
    assert.match(context!, /Quoted channel background/);
    assert.match(context!, /Original request/);
  } finally {
    await f.close();
  }
});
