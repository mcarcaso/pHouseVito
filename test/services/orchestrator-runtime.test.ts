import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import type { OutputHandler } from "../../src/lib/output/OutputHandler.js";
import { withRelay } from "../../src/services/orchestrator/runtime/RelayPiRuntime.js";
import { withTracing } from "../../src/services/orchestrator/runtime/TracingPiRuntime.js";
import type { PiRuntime } from "../../src/services/orchestrator/runtime/PiRuntime.js";
import { FileTraceEventStore } from "../../src/stores/traces/FileTraceEventStore.js";
import { FileTraceStore } from "../../src/stores/traces/FileTraceStore.js";

const fakeRuntime: PiRuntime = {
  getName: () => "fake",
  async run(_systemPrompt, _userMessage, callbacks) {
    callbacks.onInvocation?.("fake command");
    callbacks.onRawEvent({ type: "raw" });
    callbacks.onNormalizedEvent({ kind: "assistant", content: "answer" });
  },
};

describe("RelayPiRuntime", () => {
  it("streams commentary, hides private thought, and preserves the final answer", async () => {
    const delivered: string[] = [];
    const progress: string[] = [];
    const handler: OutputHandler = {
      async relay(message) {
        delivered.push(message);
      },
      async relayEvent(event) {
        if (event.content) progress.push(event.content);
      },
      async endMessage() {},
    };
    const runtime: PiRuntime = {
      getName: () => "fake",
      async run(_systemPrompt, _userMessage, callbacks) {
        callbacks.onRawEvent({
          type: "message_update",
          assistantMessageEvent: {
            type: "thinking_end",
            partial: {
              role: "assistant",
              content: [
                {
                  type: "thinking",
                  thinking: "private reasoning",
                  thinkingSignature: JSON.stringify({
                    type: "reasoning",
                    summary: [{ type: "summary_text", text: "**Checking files**" }],
                  }),
                },
              ],
            },
          },
        });
        callbacks.onNormalizedEvent({ kind: "thought", content: "private reasoning" });
        callbacks.onNormalizedEvent({ kind: "commentary", content: "Checking the files." });
        callbacks.onNormalizedEvent({ kind: "assistant", content: "Done." });
      },
    };

    await withRelay(runtime, { handler, delivery: "chat" }).run("system", "hello", {
      onRawEvent: () => undefined,
      onNormalizedEvent: () => undefined,
    });

    assert.deepEqual(progress, ["**Checking files**"]);
    assert.deepEqual(delivered, ["💬 Checking the files.", "Done."]);
  });

  it("delivers only the final answer in final mode", async () => {
    const delivered: string[] = [];
    const handler: OutputHandler = {
      async relay(message) {
        delivered.push(message);
      },
    };
    const runtime: PiRuntime = {
      getName: () => "fake",
      async run(_systemPrompt, _userMessage, callbacks) {
        callbacks.onNormalizedEvent({ kind: "thought", content: "private reasoning" });
        callbacks.onNormalizedEvent({ kind: "commentary", content: "Checking the files." });
        callbacks.onNormalizedEvent({ kind: "assistant", content: "Done." });
      },
    };

    await withRelay(runtime, { handler, delivery: "final" }).run("system", "hello", {
      onRawEvent: () => undefined,
      onNormalizedEvent: () => undefined,
    });

    assert.deepEqual(delivered, ["Done."]);
  });
});

describe("TracingPiRuntime", () => {
  it("persists trace metadata and events only through context stores", async () => {
    const logsDir = mkdtempSync(join(tmpdir(), "vito-tracing-runtime-"));
    const traceStore = new FileTraceStore();
    const traceEventStore = new FileTraceEventStore();
    const x = new ObjectContext({
      logsDir: () => logsDir,
      traceStore: () => traceStore,
      traceEventStore: () => traceEventStore,
    });
    try {
      const runtime = withTracing(fakeRuntime, {
        x,
        session_id: "dashboard:test",
        channel: "dashboard",
        target: "test",
        model: "anthropic/test",
      });
      await runtime.run("system", "hello", {
        onRawEvent: () => undefined,
        onNormalizedEvent: () => undefined,
      });

      const trace = traceStore.list(x, {})[0];
      if (!trace) throw new Error("Expected trace");
      assert.equal(trace.sessionId, "dashboard:test");
      assert.equal(trace.harness, "fake");
      assert.ok(runtime.tracePath.endsWith(trace.id));
      assert.deepEqual(
        traceEventStore
          .list(x, { traceIds: [trace.id], order: "oldest" })
          .map((event) => event.data.type),
        ["prompt", "user_message", "invocation", "raw_event", "normalized_event", "footer"],
      );
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });
});
