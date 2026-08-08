import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { FileTraceEventStore } from "../../src/stores/traces/FileTraceEventStore.js";
import { FileTraceStore } from "../../src/stores/traces/FileTraceStore.js";

function createHarness() {
  const logsDir = mkdtempSync(join(tmpdir(), "vito-trace-store-"));
  const x = new ObjectContext({ logsDir: () => logsDir });
  return {
    logsDir,
    x,
    traceStore: new FileTraceStore(),
    eventStore: new FileTraceEventStore(),
  };
}

describe("file trace stores", () => {
  it("separates trace metadata from append-only events", () => {
    const { logsDir, x, traceStore, eventStore } = createHarness();
    try {
      const trace = traceStore.create(x, {
        timestamp: "2026-01-01T00:00:00.000Z",
        sessionId: "dashboard:test",
        channel: "dashboard",
        target: "test",
        model: "anthropic/test",
        harness: "test-harness",
      });
      eventStore.create(x, {
        traceId: trace.id,
        data: { type: "user_message", content: "hello" },
      });
      eventStore.create(x, {
        traceId: trace.id,
        data: {
          type: "embedding_result",
          chunks_created: 1,
          chunks: [],
          unembedded_messages: 0,
          unembedded_chars: 0,
          duration_ms: 1,
        },
      });
      eventStore.create(x, {
        traceId: trace.id,
        data: {
          type: "footer",
          duration_ms: 1,
          message_count: 1,
          tool_calls: 0,
          success: true,
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: {
              input: 0.1,
              output: 0.15,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0.25,
            },
          },
        },
      });

      const stored = traceStore.list(x, { ids: [trace.id] })[0];
      assert.equal(stored?.sessionId, "dashboard:test");
      assert.equal(stored?.userMessage, "hello");
      assert.equal(stored?.hasEmbedding, true);
      assert.equal(stored?.cost, 0.25);

      const events = eventStore.list(x, {
        traceIds: [trace.id],
        order: "oldest",
      });
      assert.deepEqual(events.map((event) => event.data.type), [
        "user_message",
        "embedding_result",
        "footer",
      ]);
      assert.equal(eventStore.count(x, { traceIds: [trace.id] }), 3);
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("deletes complete trace aggregates", () => {
    const { logsDir, x, traceStore, eventStore } = createHarness();
    try {
      const trace = traceStore.create(x, {
        timestamp: "2026-01-01T00:00:00.000Z",
        sessionId: "dashboard:test",
        channel: "dashboard",
        target: "test",
        model: "anthropic/test",
        harness: "test-harness",
      });
      eventStore.create(x, {
        traceId: trace.id,
        data: { type: "user_message", content: "hello" },
      });

      assert.equal(traceStore.delete(x, { ids: [trace.id] }), 1);
      assert.equal(traceStore.count(x, {}), 0);
      assert.deepEqual(eventStore.list(x, { traceIds: [trace.id] }), []);
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid event envelopes before writing", () => {
    const { logsDir, x, traceStore, eventStore } = createHarness();
    try {
      const trace = traceStore.create(x, {
        timestamp: "2026-01-01T00:00:00.000Z",
        sessionId: "dashboard:test",
        channel: "dashboard",
        target: "test",
        model: "anthropic/test",
        harness: "test-harness",
      });
      assert.throws(() => eventStore.create(x, {
        traceId: trace.id,
        data: { content: "missing type" },
      }));
      assert.equal(eventStore.count(x, { traceIds: [trace.id] }), 0);
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });
});
