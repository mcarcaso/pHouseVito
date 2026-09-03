import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { createDatabase } from "../../src/lib/sqlite/database.js";
import type { AskApiOptions } from "../../src/shared/schemas/ask-api.js";
import type { AskApiService } from "../../src/services/ask/AskApiService.js";
import {
  DefaultVoiceService,
  voiceHandoffText,
} from "../../src/services/voice/DefaultVoiceService.js";
import type { MessageRow } from "../../src/stores/messages/MessageStore.js";
import { SqliteMessageStore } from "../../src/stores/messages/SqliteMessageStore.js";
import { SqliteSessionStore } from "../../src/stores/sessions/SqliteSessionStore.js";
import type { VoiceTaskRow, VoiceTaskStore } from "../../src/stores/voice/VoiceTaskStore.js";

class MemoryVoiceTaskStore implements VoiceTaskStore {
  readonly rows = new Map<string, VoiceTaskRow>();

  create(_x: ObjectContext, row: VoiceTaskRow): VoiceTaskRow {
    this.rows.set(row.id, row);
    return row;
  }

  get(_x: ObjectContext, id: string): VoiceTaskRow | null {
    return this.rows.get(id) ?? null;
  }

  listBySession(_x: ObjectContext, sessionId: string): VoiceTaskRow[] {
    return [...this.rows.values()].filter((row) => row.voice_session_id === sessionId);
  }

  update(
    _x: ObjectContext,
    id: string,
    changes: Partial<Pick<VoiceTaskRow, "status" | "result" | "error" | "updated_at">>,
  ): VoiceTaskRow {
    const current = this.rows.get(id);
    if (!current) throw new Error("Voice task not found");
    const updated = { ...current, ...changes };
    this.rows.set(id, updated);
    return updated;
  }
}

describe("DefaultVoiceService", () => {
  it("frames a turn-by-turn voice handoff as provisional context", () => {
    const rows: MessageRow[] = [
      {
        id: 1,
        session_id: "voice:1",
        channel: "voice",
        channel_target: "1",
        timestamp: Date.UTC(2026, 8, 3, 14),
        type: "user",
        content: "I prefer the first option",
        archived: 0,
        author: "mcarcaso",
      },
      {
        id: 2,
        session_id: "voice:1",
        channel: "voice",
        channel_target: "1",
        timestamp: Date.UTC(2026, 8, 3, 14, 1),
        type: "tool_end",
        content: "secret tool output",
        archived: 0,
        author: "Vito Voice",
      },
      {
        id: 3,
        session_id: "voice:1",
        channel: "voice",
        channel_target: "1",
        timestamp: Date.UTC(2026, 8, 3, 14, 2),
        type: "assistant",
        content: "Then we should use that option",
        archived: 0,
        author: "Vito Voice",
      },
    ];

    const handoff = voiceHandoffText(rows);
    assert.match(handoff, /A voice conversation just happened/);
    assert.match(handoff, /transcribed user input/);
    assert.match(handoff, /provisional rather than verified fact/);
    assert.match(handoff, /User: I prefer the first option/);
    assert.match(handoff, /Voice agent: Then we should use that option/);
    assert.doesNotMatch(handoff, /secret tool output/);
  });

  it("continues from chat messages and hands the completed transcript back exactly once", async () => {
    const db = createDatabase(":memory:");
    const sessionStore = new SqliteSessionStore();
    const messageStore = new SqliteMessageStore();
    const appended: Array<{ sessionId: string; content: string; key: string }> = [];
    const ingested: string[] = [];
    const x = new ObjectContext({
      db: () => db,
      sessionStore: () => sessionStore,
      messageStore: () => messageStore,
      orchestratorService: () =>
        ({
          appendSessionContext: async (
            _x: ObjectContext,
            sessionId: string,
            content: string,
            details: { key: string },
          ) => {
            appended.push({ sessionId, content, key: details.key });
          },
        }) as unknown,
      memoryService: () =>
        ({
          maybeProcessNewMemory: async (_x: ObjectContext, sessionId: string) => {
            ingested.push(sessionId);
            return { embedding: {}, facts: {} };
          },
        }) as unknown,
    });
    sessionStore.create(x, {
      id: "dashboard:chat",
      channel: "dashboard",
      channel_target: "chat",
      created_at: 1,
      last_active_at: 1,
      config: "{}",
      alias: "Chat",
    });
    messageStore.create(x, {
      session_id: "dashboard:chat",
      channel: "dashboard",
      channel_target: "chat",
      timestamp: 1,
      type: "user",
      content: JSON.stringify("Before voice"),
      archived: 0,
      author: "mcarcaso",
    });
    messageStore.create(x, {
      session_id: "dashboard:chat",
      channel: "dashboard",
      channel_target: "chat",
      timestamp: 2,
      type: "tool_end",
      content: JSON.stringify("tool noise"),
      archived: 0,
      author: null,
    });
    messageStore.create(x, {
      session_id: "dashboard:chat",
      channel: "dashboard",
      channel_target: "chat",
      timestamp: 3,
      type: "assistant",
      content: JSON.stringify("Ready for voice"),
      archived: 0,
      author: "Vito",
    });
    const service = new DefaultVoiceService({
      configure: () => undefined,
      isConfigured: () => true,
      ask: async () => "unused",
    });

    assert.deepEqual(service.getConversationContext(x, "dashboard:chat"), [
      { role: "user", text: "Before voice" },
      { role: "assistant", text: "Ready for voice" },
    ]);
    await service.recordEvent(x, {
      sessionId: "voice:test",
      parentSessionId: "dashboard:chat",
      kind: "user",
      content: "Spoken request",
    });
    await service.recordEvent(x, {
      sessionId: "voice:test",
      parentSessionId: "dashboard:chat",
      kind: "assistant",
      content: "Spoken answer",
    });
    const endEvent = {
      sessionId: "voice:test",
      parentSessionId: "dashboard:chat",
      kind: "session_end" as const,
      content: JSON.stringify({ durationMs: 1_000 }),
    };
    await service.recordEvent(x, endEvent);
    await service.recordEvent(x, endEvent);
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(appended.length, 1);
    assert.equal(appended[0]?.sessionId, "dashboard:chat");
    assert.equal(appended[0]?.key, "voice-handoff:voice:test");
    assert.match(appended[0]?.content ?? "", /Spoken request/);
    assert.match(appended[0]?.content ?? "", /Spoken answer/);
    const handoffs = messageStore
      .list(x, { sessionIds: ["dashboard:chat"], types: ["assistant"] })
      .filter((message) => message.author === "Vito Voice");
    assert.equal(handoffs.length, 1);
    assert.deepEqual(ingested, ["voice:test"]);
    db.close();
  });

  it("delegates each voice task to an independent investigator session", async () => {
    const store = new MemoryVoiceTaskStore();
    const asks: AskApiOptions[] = [];
    const resolvers: Array<(result: string) => void> = [];
    const askApiService: AskApiService = {
      configure: () => undefined,
      isConfigured: () => true,
      ask: async (_x, options) => {
        asks.push(options);
        return await new Promise<string>((resolve) => resolvers.push(resolve));
      },
    };
    const x = new ObjectContext({ voiceTaskStore: () => store });
    const service = new DefaultVoiceService(askApiService);

    const first = service.askAsync(x, "voice:123", "First task");
    const second = service.askAsync(x, "voice:123", "Second task");

    assert.equal(asks.length, 2);
    assert.equal(asks[0]?.session, `voice-investigator:${first.id}`);
    assert.equal(asks[1]?.session, `voice-investigator:${second.id}`);
    assert.equal(asks[0]?.question, "First task");
    assert.equal(asks[1]?.question, "Second task");
    assert.notEqual(asks[0]?.session, asks[1]?.session);
    assert.equal(store.get(x, first.id)?.status, "running");
    assert.equal(store.get(x, second.id)?.status, "running");

    resolvers[0]?.("First result");
    resolvers[1]?.("Second result");
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(store.get(x, first.id)?.result, "First result");
    assert.equal(store.get(x, second.id)?.result, "Second result");
  });
});
