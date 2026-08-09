import { z } from "zod";

const normalizedEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("assistant"), content: z.string() }).strict(),
  z.object({
    kind: z.literal("tool_start"),
    tool: z.string(),
    callId: z.string(),
    args: z.unknown(),
  }).strict(),
  z.object({
    kind: z.literal("tool_end"),
    tool: z.string(),
    callId: z.string(),
    result: z.string(),
    success: z.boolean(),
  }).strict(),
  z.object({ kind: z.literal("error"), message: z.string() }).strict(),
]);

const usageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  totalTokens: z.number(),
  cost: z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    total: z.number(),
  }).strict(),
}).strict();

const invocationSchema = z.object({
  type: z.literal("invocation"),
  command: z.string(),
}).strict();

const promptSchema = z.object({
  type: z.literal("prompt"),
  content: z.string(),
  length: z.number().int().nonnegative(),
}).strict();

const userMessageSchema = z.object({
  type: z.literal("user_message"),
  content: z.string(),
  attachments: z.array(z.object({
    type: z.string(),
    path: z.string(),
  }).passthrough()).optional(),
}).strict();

const rawEventSchema = z.object({
  type: z.literal("raw_event"),
  ts: z.number().nonnegative(),
  event: z.unknown(),
}).strict();

const normalizedTraceEventSchema = z.object({
  type: z.literal("normalized_event"),
  ts: z.number().nonnegative(),
  event: normalizedEventSchema,
}).strict();

const memorySearchResultSchema = z.object({
  id: z.number(),
  session_id: z.string(),
  day: z.string(),
  context: z.string().nullable(),
  rrf_score: z.number(),
  embedding_score: z.number(),
  bm25_score: z.number(),
  text_preview: z.string(),
  full_text: z.string().optional(),
}).passthrough();

const memorySearchSchema = z.object({
  type: z.literal("memory_search"),
  query: z.string(),
  original_query: z.string().optional(),
  contextual_query: z.string().optional(),
  contextualizer_duration_ms: z.number().optional(),
  contextualizer_skipped: z.string().optional(),
  duration_ms: z.number(),
  results_found: z.number().int().nonnegative(),
  results_injected: z.number().int().nonnegative(),
  results: z.array(memorySearchResultSchema),
  skipped: z.string().optional(),
}).strict();

const currentContextFilterSchema = z.object({
  type: z.literal("current_context_filter"),
  excludeEmbedded: z.boolean(),
  lastEmbeddedMsgId: z.number(),
  keepRecentEmbeddedMessages: z.number().int().nonnegative(),
  rawMessagesIncluded: z.number().int().nonnegative(),
  embeddedMessagesExcluded: z.number().int().nonnegative(),
}).strict();

const autoClassifierSchema = z.object({
  type: z.literal("auto_classifier"),
  ran: z.boolean(),
  duration_ms: z.number(),
  skipped: z.string().optional(),
  traceFile: z.string().optional(),
  explanation: z.string().optional(),
  currentContextLimit: z.number().optional(),
  currentContextIncludeWorkingContext: z.boolean().optional(),
  crossContextLimit: z.number().optional(),
  crossContextMaxSessions: z.number().optional(),
  crossContextIncludeWorkingContext: z.boolean().optional(),
  recalledMemoryLimit: z.number().optional(),
  selectedModel: z.string().optional(),
}).strict();

const embeddingChunkSchema = z.object({
  day: z.string(),
  chunk_index: z.number().int().nonnegative(),
  msg_count: z.number().int().nonnegative(),
  char_count: z.number().int().nonnegative(),
  context: z.string(),
}).strict();

const embeddingResultSchema = z.object({
  type: z.literal("embedding_result"),
  skipped: z.string().optional(),
  chunks_created: z.number().int().nonnegative(),
  chunks: z.array(embeddingChunkSchema),
  unembedded_messages: z.number().int().nonnegative(),
  unembedded_chars: z.number().int().nonnegative(),
  duration_ms: z.number().nonnegative(),
}).strict();

const profileUpdateSchema = z.object({
  type: z.literal("profile_update"),
  skipped: z.string().optional(),
  updated: z.boolean().optional(),
  updates_applied: z.number().int().nonnegative().optional(),
  updates: z.array(z.object({
    path: z.string(),
    action: z.string(),
    value: z.unknown(),
  }).strict()).optional(),
  duration_ms: z.number().nonnegative(),
  traceFile: z.string().optional(),
  events: z.array(normalizedEventSchema).optional(),
}).strict();

const footerSchema = z.object({
  type: z.literal("footer"),
  duration_ms: z.number().nonnegative(),
  message_count: z.number().int().nonnegative(),
  tool_calls: z.number().int().nonnegative(),
  success: z.boolean(),
  error: z.string().optional(),
  usage: usageSchema.optional(),
}).strict();

const truncatedSchema = z.object({
  type: z.literal("truncated"),
  reason: z.string(),
}).strict();

const parseErrorSchema = z.object({
  type: z.literal("parse_error"),
  raw: z.string(),
}).strict();

export const writableTraceEventDataSchema = z.discriminatedUnion("type", [
  invocationSchema,
  promptSchema,
  userMessageSchema,
  rawEventSchema,
  normalizedTraceEventSchema,
  memorySearchSchema,
  currentContextFilterSchema,
  autoClassifierSchema,
  embeddingResultSchema,
  profileUpdateSchema,
  footerSchema,
  truncatedSchema,
]);

export const traceEventDataSchema = z.discriminatedUnion("type", [
  ...writableTraceEventDataSchema.options,
  parseErrorSchema,
]);

export type WritableTraceEventData = z.infer<typeof writableTraceEventDataSchema>;
export type TraceEventData = z.infer<typeof traceEventDataSchema>;
export type TraceEventType = TraceEventData["type"];
