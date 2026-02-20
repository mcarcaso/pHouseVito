// === JSONL Trace Types ===
// Each trace is a .jsonl file with one JSON object per line
// The format is HARNESS-AGNOSTIC — swap harnesses without changing the UI

/**
 * Header - session/channel/harness/timestamp metadata
 */
export interface TraceHeader {
  type: "header";
  timestamp: string;          // ISO date
  session_id: string;
  channel: string;
  target: string;
  harness: string;            // Which harness was used (pi-coding-agent, claude-code, etc.)
}

/**
 * Invocation - the CLI command used to start the harness
 */
export interface TraceInvocation {
  type: "invocation";
  command: string;            // CLI equivalent command
}

/**
 * Prompt - the full system prompt
 */
export interface TracePrompt {
  type: "prompt";
  content: string;            // Full system prompt text
  length: number;             // Character count
}

/**
 * UserMessage - what the user said (plus any attachments)
 */
export interface TraceUserMessage {
  type: "user_message";
  content: string;            // User's message text
  attachments?: {
    type: string;
    path: string;
  }[];
}

// ══════════════════════════════════════════════════════════════════════════════
// RAW HARNESS EVENTS — Exactly what the harness spits out, untouched
// ══════════════════════════════════════════════════════════════════════════════

/**
 * RawEvent - raw harness event, logged exactly as received
 * One line per event from the harness
 * Note: message_update events are omitted by default (configurable)
 */
export interface TraceRawEvent {
  type: "raw_event";
  ts: number;                 // ms offset from request start
  event: unknown;             // The raw harness event, whatever shape it has
}

// ══════════════════════════════════════════════════════════════════════════════
// NORMALIZED EVENTS — Matches what we store in the messages table
// These are the "business events" — what actually matters
// ══════════════════════════════════════════════════════════════════════════════

export type NormalizedEventKind =
  | { kind: "assistant"; content: string }
  | { kind: "tool_start"; tool: string; callId: string; args: unknown }
  | { kind: "tool_end"; tool: string; callId: string; result: string; success: boolean }
  | { kind: "error"; message: string };

/**
 * NormalizedEvent - mirrors what goes in the messages table
 * Only emitted for actual business events, not streaming internals
 */
export interface TraceNormalizedEvent {
  type: "normalized_event";
  ts: number;                 // ms offset from request start
  event: NormalizedEventKind;
}

/**
 * Footer - duration, counts, success/error summary
 */
export interface TraceFooter {
  type: "footer";
  duration_ms: number;
  message_count: number;
  tool_calls: number;
  success: boolean;
  error?: string;
}

/**
 * Union type for all trace line types
 */
export type TraceLine =
  | TraceHeader
  | TraceInvocation
  | TracePrompt
  | TraceUserMessage
  | TraceRawEvent
  | TraceNormalizedEvent
  | TraceFooter;
