import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { steeringHandoff } from "../../src/services/orchestrator/steering-handoff.js";

function fake() {
  let listener: ((event: AgentSessionEvent) => void) | undefined;
  let queued = false;
  const session = {
    isStreaming: true,
    subscribe(fn: typeof listener) {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
    agent: {
      hasQueuedMessages: () => queued,
      steer: () => {
        queued = true;
      },
      clearSteeringQueue: () => {
        queued = false;
      },
    },
  };
  return {
    session: session as unknown as AgentSession,
    queued: () => queued,
    emit: (event: unknown) => listener?.(event as AgentSessionEvent),
  };
}

it("rejects a late handoff at turn end and removes the unconsumed Pi input", async () => {
  const f = fake();
  const result = steeringHandoff(f.session, "redirect");
  assert.equal(f.queued(), true);
  f.emit({ type: "agent_end", messages: [] });
  assert.equal(await result, false);
  assert.equal(f.queued(), false);
});

it("acknowledges only actual user-message consumption, not assistant reply events", async () => {
  const f = fake();
  const result = steeringHandoff(f.session, "redirect");
  f.emit({
    type: "message_start",
    message: { role: "assistant", content: [{ type: "text", text: "redirect" }] },
  });
  f.emit({
    type: "message_start",
    message: { role: "user", content: [{ type: "text", text: "redirect" }] },
  });
  assert.equal(await result, true);
});

it("does not queue after streaming ends or overwrite existing Pi input", async () => {
  const f = fake();
  Object.assign(f.session, { isStreaming: false });
  assert.equal(await steeringHandoff(f.session, "late"), false);
  assert.equal(f.queued(), false);
  Object.assign(f.session, { isStreaming: true });
  const first = steeringHandoff(f.session, "first");
  assert.equal(await steeringHandoff(f.session, "second"), false);
  f.emit({ type: "agent_end", messages: [] });
  assert.equal(await first, false);
});
