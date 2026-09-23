export type OutboundMessage = string;

export type AgentActivity =
  | "thinking"
  | "reading"
  | "writing"
  | "executing"
  | "delegating"
  | "tool"
  | "responding"
  | "finishing";

export interface AgentActivityEvent {
  kind: "tool_start" | "tool_end" | "thinking";
  toolName?: string;
  toolCallId?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  content?: string;
  activity?: AgentActivity;
}

/** Transport adapter used to deliver agent activity to a channel target. */
export interface OutputHandler {
  relay(message: OutboundMessage): Promise<void>;
  relayEvent?(event: AgentActivityEvent): Promise<void>;
  startTyping?(): Promise<void>;
  stopTyping?(): Promise<void>;
  endMessage?(): Promise<void>;
  startReaction?(emoji?: string): Promise<void>;
  stopReaction?(): Promise<void>;
}
