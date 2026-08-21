export interface TraceHeader {
  type: "header";
  timestamp: string;
  session_id: string;
  channel: string;
  target: string;
  model: string;
  harness: string;
}

export interface TraceInvocation {
  type: "invocation";
  command: string;
}

export interface TracePrompt {
  type: "prompt";
  content: string;
  length: number;
}

export interface TraceUserMessage {
  type: "user_message";
  content: string;
  attachments?: { type: string; path: string }[];
}

// Raw event — exactly what the Pi runtime emitted
export interface TraceRawEvent {
  type: "raw_event";
  ts: number;
  event: unknown;
}

// Normalized event — the stable event format used by Vito
export interface TraceNormalizedEvent {
  type: "normalized_event";
  ts: number;
  event: unknown;
}

export interface TraceMemorySearch {
  type: "memory_search";
  query: string;
  original_query?: string;
  contextual_query?: string;
  contextualizer_duration_ms?: number;
  contextualizer_skipped?: string;
  duration_ms: number;
  results_found: number;
  results_injected: number;
  results: {
    id: number;
    session_id: string;
    day: string;
    context: string | null;
    rrf_score: number;
    embedding_score: number;
    bm25_score: number;
    text_preview: string;
    full_text?: string; // Full chunk text (for expanded view)
  }[];
  skipped?: string;
}

export interface TraceCurrentContextFilter {
  type: "current_context_filter";
  excludeEmbedded: boolean;
  lastEmbeddedMsgId: number;
  keepRecentEmbeddedMessages: number;
  rawMessagesIncluded: number;
  embeddedMessagesExcluded: number;
}

export interface TraceAutoClassifier {
  type: "auto_classifier";
  ran: boolean;
  duration_ms: number;
  skipped?: string;
  traceFile?: string;
  explanation?: string;
  currentContextLimit?: number;
  currentContextIncludeWorkingContext?: boolean;
  crossContextLimit?: number;
  crossContextMaxSessions?: number;
  crossContextIncludeWorkingContext?: boolean;
  recalledMemoryLimit?: number;
  selectedModel?: string;
}

export interface TraceEmbeddingResult {
  type: "embedding_result";
  skipped?: string;
  chunks_created: number;
  chunks: {
    day: string;
    chunk_index: number;
    msg_count: number;
    char_count: number;
    context: string;
  }[];
  unembedded_messages: number;
  unembedded_chars: number;
  duration_ms: number;
}

export interface TraceProfileUpdate {
  type: "profile_update";
  skipped?: string;
  updated?: boolean;
  updates_applied?: number;
  updates?: {
    path: string;
    action: string;
    value: unknown;
  }[];
  duration_ms: number;
  traceFile?: string; // Path to the dedicated profile update trace file
  events?: NormalizedEvent[]; // Legacy: inline events (for old traces)
}

// Normalized event types from the Pi runtime
export interface NormalizedEvent {
  kind: string;
  tool?: string;
  callId?: string;
  args?: Record<string, unknown>;
  result?: string;
  success?: boolean;
  content?: string;
  message?: string;
}

export interface TraceFooter {
  type: "footer";
  duration_ms: number;
  message_count: number;
  tool_calls: number;
  success: boolean;
  error?: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
}

export type TraceLine =
  | TraceHeader
  | TraceInvocation
  | TracePrompt
  | TraceUserMessage
  | TraceRawEvent
  | TraceNormalizedEvent
  | TraceMemorySearch
  | TraceCurrentContextFilter
  | TraceAutoClassifier
  | TraceEmbeddingResult
  | TraceProfileUpdate
  | TraceFooter;

export interface LogFile {
  filename: string;
  timestamp: number;
  size: number;
  preview: string;
  format: "jsonl";
  sessionId?: string;
  alias?: string | null;
  hasEmbedding?: boolean;
  userMessage?: string;
  traceType?: "main" | "classifier" | "profile";
  cost?: number | null;
}

export interface LogDetailJsonl {
  filename: string;
  format: "jsonl";
  lines: TraceLine[];
}

export type LogDetail = LogDetailJsonl;
