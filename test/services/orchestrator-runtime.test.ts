import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
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
        ["prompt", "user_message", "invocation", "raw_event", "normalized_event", "footer"]
      );
    } finally {
      rmSync(logsDir, { recursive: true, force: true });
    }
  });
});
