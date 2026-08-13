import type {
  TraceAutoClassifier,
  TraceCurrentContextFilter,
  TraceEmbeddingResult,
  TraceMemorySearch,
  TraceProfileUpdate,
} from "./trace-types";
import { formatMs } from "./trace-utils";

export default function TraceMemorySections({
  memorySearch,
  currentContextFilter,
  autoClassifier,
  embeddingResult,
  profileUpdate,
  expandedSections,
  toggleSection,
  openTrace,
}: {
  memorySearch?: TraceMemorySearch;
  currentContextFilter?: TraceCurrentContextFilter;
  autoClassifier?: TraceAutoClassifier;
  embeddingResult?: TraceEmbeddingResult;
  profileUpdate?: TraceProfileUpdate;
  expandedSections: Set<string>;
  toggleSection: (key: string) => void;
  openTrace: (filename: string) => void;
}) {
  return (
    <>
      {/* Current Context Filter */}
      {currentContextFilter && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
          <div className="text-xs text-neutral-500 mb-2 font-medium">Current Context Filter</div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="bg-neutral-800 text-neutral-300 px-2 py-1 rounded font-mono">
              excludeEmbedded: {String(currentContextFilter.excludeEmbedded)}
            </span>
            <span className="bg-neutral-800 text-neutral-300 px-2 py-1 rounded font-mono">
              lastEmbeddedMsgId: {currentContextFilter.lastEmbeddedMsgId}
            </span>
            <span className="bg-neutral-800 text-neutral-300 px-2 py-1 rounded font-mono">
              keepTail: {currentContextFilter.keepRecentEmbeddedMessages}
            </span>
            <span className="bg-neutral-800 text-neutral-300 px-2 py-1 rounded font-mono">
              included: {currentContextFilter.rawMessagesIncluded}
            </span>
            <span className="bg-neutral-800 text-neutral-300 px-2 py-1 rounded font-mono">
              excluded: {currentContextFilter.embeddedMessagesExcluded}
            </span>
          </div>
        </div>
      )}

      {/* Memory Search */}
      {memorySearch && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
          <button
            className="w-full px-4 py-2 flex items-center justify-between text-left bg-neutral-800/50 hover:bg-neutral-800 transition-colors"
            onClick={() => toggleSection("memory-search")}
          >
            <span className="text-sm font-medium text-neutral-300 flex items-center gap-2">
              🧠 Memory Search
              {memorySearch.skipped ? (
                <span className="text-neutral-500 font-normal text-xs">
                  skipped — {memorySearch.skipped}
                </span>
              ) : (
                <>
                  <span className="text-neutral-500 font-normal text-xs">
                    {memorySearch.results_injected}/{memorySearch.results_found} injected
                  </span>
                  <span className="text-neutral-600 font-normal text-xs">
                    ({formatMs(memorySearch.duration_ms)})
                  </span>
                </>
              )}
            </span>
            <span className="text-neutral-500">
              {expandedSections.has("memory-search") ? "−" : "+"}
            </span>
          </button>
          {expandedSections.has("memory-search") && (
            <div className="p-4 space-y-3">
              <div className="text-xs text-neutral-500 space-y-2">
                {memorySearch.original_query && (
                  <div>
                    Original:{" "}
                    <span className="text-neutral-300 font-mono">
                      "{memorySearch.original_query}"
                    </span>
                  </div>
                )}
                {memorySearch.contextual_query && (
                  <div>
                    Contextual:{" "}
                    <span className="text-violet-300 font-mono whitespace-pre-wrap">
                      "{memorySearch.contextual_query}"
                    </span>
                  </div>
                )}
                {memorySearch.contextualizer_duration_ms !== undefined && (
                  <div>
                    Contextualizer:{" "}
                    <span className="text-neutral-300 font-mono">
                      {formatMs(memorySearch.contextualizer_duration_ms)}
                    </span>
                    {memorySearch.contextualizer_skipped ? (
                      <span className="text-neutral-600">
                        {" "}
                        — {memorySearch.contextualizer_skipped}
                      </span>
                    ) : null}
                  </div>
                )}
                <div>
                  Search text:{" "}
                  <span className="text-neutral-300 font-mono whitespace-pre-wrap">
                    "{memorySearch.query}"
                  </span>
                </div>
              </div>
              {memorySearch.results.length > 0 ? (
                <div className="space-y-2">
                  {memorySearch.results.map((r, i) => (
                    <div
                      key={r.id}
                      className={`rounded-lg p-3 border ${i < memorySearch.results_injected ? "bg-emerald-950/20 border-emerald-900/40" : "bg-neutral-800/30 border-neutral-700/30"}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded font-mono ${i < memorySearch.results_injected ? "bg-emerald-900/40 text-emerald-400" : "bg-neutral-700/50 text-neutral-500"}`}
                        >
                          #{i + 1}
                        </span>
                        <span className="text-xs text-neutral-400 font-mono">{r.day}</span>
                        <span className="text-xs text-neutral-600 font-mono truncate">
                          {r.session_id}
                        </span>
                        <div className="ml-auto flex items-center gap-2">
                          <span className="text-xs text-neutral-600" title="RRF Score">
                            RRF: <span className="text-neutral-400">{r.rrf_score.toFixed(4)}</span>
                          </span>
                          <span className="text-xs text-neutral-600" title="Embedding Score">
                            EMB:{" "}
                            <span className="text-neutral-400">{r.embedding_score.toFixed(3)}</span>
                          </span>
                          <span className="text-xs text-neutral-600" title="BM25 Score">
                            BM25:{" "}
                            <span className="text-neutral-400">{r.bm25_score.toFixed(2)}</span>
                          </span>
                        </div>
                      </div>
                      {r.context && (
                        <div className="text-xs text-violet-400/70 mb-1 italic">{r.context}</div>
                      )}
                      <div className="text-xs text-neutral-400 font-mono whitespace-pre-wrap break-words">
                        {r.full_text || r.text_preview}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-neutral-600 italic">No results returned</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Auto Classifier */}
      {autoClassifier && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
          <div className="px-4 py-2 flex items-center justify-between bg-neutral-800/50 gap-3">
            <span className="text-sm font-medium text-neutral-300 flex items-center gap-2 flex-wrap">
              🤖 Auto Classifier
              {autoClassifier.ran ? (
                <>
                  <span className="text-amber-400 font-normal text-xs">✓ Applied</span>
                  <span className="text-neutral-600 font-normal text-xs">
                    ({formatMs(autoClassifier.duration_ms)})
                  </span>
                </>
              ) : (
                <>
                  <span className="text-neutral-500 font-normal text-xs">
                    skipped — {autoClassifier.skipped || "not run"}
                  </span>
                  <span className="text-neutral-600 font-normal text-xs">
                    ({formatMs(autoClassifier.duration_ms)})
                  </span>
                </>
              )}
            </span>
            {autoClassifier.traceFile && (
              <button
                className="text-xs text-blue-400 hover:text-blue-300 font-mono bg-blue-500/10 hover:bg-blue-500/20 px-2 py-1 rounded transition-colors whitespace-nowrap"
                onClick={() => {
                  const filename =
                    autoClassifier.traceFile!.split("/").pop() || autoClassifier.traceFile!;
                  openTrace(filename);
                }}
              >
                View Trace →
              </button>
            )}
          </div>
          {(autoClassifier.explanation ||
            autoClassifier.selectedModel ||
            autoClassifier.currentContextLimit !== undefined ||
            autoClassifier.currentContextIncludeWorkingContext !== undefined ||
            autoClassifier.crossContextLimit !== undefined ||
            autoClassifier.crossContextMaxSessions !== undefined ||
            autoClassifier.crossContextIncludeWorkingContext !== undefined ||
            autoClassifier.recalledMemoryLimit !== undefined) && (
            <div className="p-4 space-y-3 border-t border-neutral-800">
              {autoClassifier.explanation && (
                <div>
                  <div className="text-xs text-neutral-500 mb-1">Reasoning</div>
                  <div className="text-sm text-neutral-300 whitespace-pre-wrap break-words">
                    {autoClassifier.explanation}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 text-xs">
                {autoClassifier.selectedModel && (
                  <span className="bg-amber-500/10 text-amber-300 px-2 py-1 rounded font-mono">
                    model: {autoClassifier.selectedModel}
                  </span>
                )}
                {autoClassifier.currentContextLimit !== undefined && (
                  <span className="bg-neutral-800 text-neutral-300 px-2 py-1 rounded font-mono">
                    context: {autoClassifier.currentContextLimit}
                  </span>
                )}
                {autoClassifier.currentContextIncludeWorkingContext !== undefined && (
                  <span className="bg-neutral-800 text-neutral-300 px-2 py-1 rounded font-mono">
                    working: {String(autoClassifier.currentContextIncludeWorkingContext)}
                  </span>
                )}
                {autoClassifier.crossContextLimit !== undefined && (
                  <span className="bg-neutral-800 text-neutral-300 px-2 py-1 rounded font-mono">
                    cross: {autoClassifier.crossContextLimit}
                  </span>
                )}
                {autoClassifier.crossContextMaxSessions !== undefined && (
                  <span className="bg-neutral-800 text-neutral-300 px-2 py-1 rounded font-mono">
                    crossSessions: {autoClassifier.crossContextMaxSessions}
                  </span>
                )}
                {autoClassifier.crossContextIncludeWorkingContext !== undefined && (
                  <span className="bg-neutral-800 text-neutral-300 px-2 py-1 rounded font-mono">
                    crossWorking: {String(autoClassifier.crossContextIncludeWorkingContext)}
                  </span>
                )}
                {autoClassifier.recalledMemoryLimit !== undefined && (
                  <span className="bg-neutral-800 text-neutral-300 px-2 py-1 rounded font-mono">
                    memory: {autoClassifier.recalledMemoryLimit}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Embeddings */}
      {embeddingResult && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
          <button
            className="w-full px-4 py-2 flex items-center justify-between text-left bg-neutral-800/50 hover:bg-neutral-800 transition-colors"
            onClick={() => toggleSection("embedding-result")}
          >
            <span className="text-sm font-medium text-neutral-300 flex items-center gap-2">
              🧬 Embedding Result
              {embeddingResult.skipped ? (
                <span className="text-neutral-500 font-normal text-xs">
                  skipped — {embeddingResult.skipped}
                </span>
              ) : (
                <>
                  <span className="text-neutral-500 font-normal text-xs">
                    {embeddingResult.chunks_created} chunk
                    {embeddingResult.chunks_created === 1 ? "" : "s"}
                  </span>
                  <span className="text-neutral-600 font-normal text-xs">
                    ({formatMs(embeddingResult.duration_ms)})
                  </span>
                </>
              )}
            </span>
            <span className="text-neutral-500">
              {expandedSections.has("embedding-result") ? "−" : "+"}
            </span>
          </button>
          {expandedSections.has("embedding-result") && (
            <div className="p-4 space-y-3">
              <div className="text-xs text-neutral-500">
                Unembedded buffer:{" "}
                <span className="text-neutral-300 font-mono">
                  {embeddingResult.unembedded_messages} msgs
                </span>
                <span className="text-neutral-600"> • </span>
                <span className="text-neutral-300 font-mono">
                  {embeddingResult.unembedded_chars} chars
                </span>
              </div>
              {embeddingResult.chunks.length > 0 ? (
                <div className="space-y-2">
                  {embeddingResult.chunks.map((c, i) => (
                    <div
                      key={`${c.day}-${c.chunk_index}-${i}`}
                      className="rounded-lg p-3 border bg-neutral-800/30 border-neutral-700/30"
                    >
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <span className="text-xs px-1.5 py-0.5 rounded font-mono bg-neutral-700/50 text-neutral-300">
                          #{c.chunk_index}
                        </span>
                        <span className="text-xs text-neutral-400 font-mono">{c.day}</span>
                        <div className="ml-auto flex items-center gap-2">
                          <span className="text-xs text-neutral-600">
                            msgs: <span className="text-neutral-300">{c.msg_count}</span>
                          </span>
                          <span className="text-xs text-neutral-600">
                            chars: <span className="text-neutral-300">{c.char_count}</span>
                          </span>
                        </div>
                      </div>
                      <div className="text-xs text-violet-400/70 italic">{c.context}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-neutral-600 italic">No chunks created</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Profile Update */}
      {profileUpdate && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
          <div className="px-4 py-2 flex items-center justify-between bg-neutral-800/50">
            <span className="text-sm font-medium text-neutral-300 flex items-center gap-2">
              👤 Profile Update
              {profileUpdate.skipped ? (
                <span className="text-neutral-500 font-normal text-xs">
                  skipped — {profileUpdate.skipped}
                </span>
              ) : profileUpdate.updated ? (
                <>
                  <span className="text-emerald-400 font-normal text-xs">✓ Updated</span>
                  <span className="text-neutral-600 font-normal text-xs">
                    ({formatMs(profileUpdate.duration_ms)})
                  </span>
                </>
              ) : (
                <>
                  <span className="text-neutral-500 font-normal text-xs">no changes</span>
                  <span className="text-neutral-600 font-normal text-xs">
                    ({formatMs(profileUpdate.duration_ms)})
                  </span>
                </>
              )}
            </span>
            {/* Link to dedicated trace file */}
            {profileUpdate.traceFile && (
              <button
                className="text-xs text-blue-400 hover:text-blue-300 font-mono bg-blue-500/10 hover:bg-blue-500/20 px-2 py-1 rounded transition-colors"
                onClick={() => {
                  // Extract just the filename from the path (e.g., "logs/trace-profile-xxx.jsonl" -> "trace-profile-xxx.jsonl")
                  const filename =
                    profileUpdate.traceFile!.split("/").pop() || profileUpdate.traceFile!;
                  openTrace(filename);
                }}
              >
                View Trace →
              </button>
            )}
          </div>

          {/* Legacy: inline events for old traces that don't have traceFile */}
          {!profileUpdate.traceFile && profileUpdate.events && profileUpdate.events.length > 0 && (
            <div className="p-4 space-y-3 border-t border-neutral-800">
              <div className="text-xs font-medium text-neutral-400 mb-2">
                Event Stream ({profileUpdate.events.length} events)
              </div>
              <div className="space-y-2">
                {profileUpdate.events.map((event, i) => (
                  <div key={i} className="bg-neutral-800/50 rounded p-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                          event.kind === "tool_start"
                            ? "bg-blue-500/20 text-blue-400"
                            : event.kind === "tool_end"
                              ? event.success
                                ? "bg-emerald-500/20 text-emerald-400"
                                : "bg-red-500/20 text-red-400"
                              : event.kind === "assistant"
                                ? "bg-violet-500/20 text-violet-400"
                                : event.kind === "error"
                                  ? "bg-red-500/20 text-red-400"
                                  : "bg-neutral-700 text-neutral-400"
                        }`}
                      >
                        {event.kind}
                      </span>
                      {event.tool && (
                        <span className="text-xs text-neutral-500 font-mono">{event.tool}</span>
                      )}
                    </div>

                    {/* Tool Start — show args */}
                    {event.kind === "tool_start" && event.args && (
                      <pre className="text-xs text-neutral-400 bg-neutral-900 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-40">
                        {JSON.stringify(event.args, null, 2)}
                      </pre>
                    )}

                    {/* Tool End — show result (truncated) */}
                    {event.kind === "tool_end" && event.result && (
                      <pre className="text-xs text-neutral-400 bg-neutral-900 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-40">
                        {event.result.length > 1000
                          ? event.result.slice(0, 1000) + "\n... (truncated)"
                          : event.result}
                      </pre>
                    )}

                    {/* Assistant — show content */}
                    {event.kind === "assistant" && event.content && (
                      <div className="text-xs text-neutral-300 mt-1">{event.content}</div>
                    )}

                    {/* Error — show message */}
                    {event.kind === "error" && event.message && (
                      <div className="text-xs text-red-400 mt-1">{event.message}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
