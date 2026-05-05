/**
 * UI feature flags.
 *
 * Settings sections that are obsolete under orchestrator v2 are gated on
 * these flags. The underlying types and config fields remain in place — the
 * flags only control whether the settings UI exposes them. Flip any of them
 * to `true` to bring the legacy UI back without a code revert.
 *
 * What v2 still uses (always shown): harness, model, thinkingLevel,
 * streamMode, requireMention, customInstructions, traceMessageUpdates,
 * memory.profileUpdateContext, timezone, channels, sessions, harness
 * configs, cron jobs.
 */

/**
 * Current Session Context (currentContext.*): limit, includeThoughts,
 * includeTools, includeArchived, excludeEmbedded, keepRecentEmbeddedMessages.
 *
 * Obsolete because pi-coding-agent keeps the conversation in its own
 * session state across turns; the orchestrator no longer assembles a
 * <memory> block from SQLite messages.
 */
export const SHOW_LEGACY_CURRENT_CONTEXT = false;

/**
 * Cross-Session Context (crossContext.*): limit, maxSessions, includeThoughts,
 * includeTools, includeArchived.
 *
 * Obsolete because cross-session context is now agent-initiated via memory
 * skills (semantic-history-search / keyword-history-search) rather than
 * pre-injected.
 */
export const SHOW_LEGACY_CROSS_CONTEXT = false;

/**
 * Memory Recall (memory.recalledMemoryLimit, memory.recalledMemoryThreshold,
 * memory.contextualizeQuery, memory.queryContextMessages,
 * memory.queryContextualizerModel).
 *
 * Obsolete because the orchestrator no longer auto-runs semantic search
 * before each turn. The agent calls the memory-search skills on demand.
 *
 * Note: memory.profileUpdateContext is NOT covered by this flag — it's
 * still used by the background profile updater and remains visible.
 */
export const SHOW_LEGACY_MEMORY_RECALL = false;

/**
 * Auto Classifier (auto.* tree, including auto.classifierModel,
 * auto.classifierContext, auto.currentContext, auto.crossContext,
 * auto.memory, auto["pi-coding-agent"]).
 *
 * Obsolete because v2 doesn't run a per-turn classifier — settings come
 * directly from the cascade.
 */
export const SHOW_LEGACY_AUTO_CLASSIFIER = false;
