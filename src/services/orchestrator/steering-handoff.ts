import type { AgentSession } from "@earendil-works/pi-coding-agent";

/** Vito supplies an already-expanded prompt. Queue synchronously, acknowledge consumption. */
export function steeringHandoff(session: AgentSession, text: string): Promise<boolean> {
  if (!session.isStreaming) return Promise.resolve(false);
  // Only one handoff at a time; do not clear somebody else's queued input on rollback.
  if (session.agent.hasQueuedMessages()) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let consumed = false;
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_start" && event.message.role === "user") {
        const content = event.message.content;
        if (
          Array.isArray(content) &&
          content.some((part) => part.type === "text" && part.text === text)
        ) {
          consumed = true;
          unsubscribe();
          resolve(true);
        }
      } else if (event.type === "agent_end") {
        if (!consumed) session.agent.clearSteeringQueue();
        unsubscribe();
        resolve(consumed);
      }
    });
    session.agent.steer({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
  });
}
