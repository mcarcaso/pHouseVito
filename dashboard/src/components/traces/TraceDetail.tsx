import type {
  LogDetailJsonl,
  TraceAutoClassifier,
  TraceCurrentContextFilter,
  TraceEmbeddingResult,
  TraceFooter,
  TraceHeader,
  TraceInvocation,
  TraceMemorySearch,
  TraceNormalizedEvent,
  TraceProfileUpdate,
  TracePrompt,
  TraceRawEvent,
  TraceUserMessage,
} from "./trace-types";
import TraceEvents from "./TraceEvents";
import TraceMemorySections from "./TraceMemorySections";
import { formatMs } from "./trace-utils";

export default function TraceDetail({
  detail,
  showRaw,
  onShowRawChange,
  expandedSections,
  toggleSection,
  openTrace,
}: {
  detail: LogDetailJsonl;
  showRaw: boolean;
  onShowRawChange: (showRaw: boolean) => void;
  expandedSections: Set<string>;
  toggleSection: (key: string) => void;
  openTrace: (filename: string) => void;
}) {
  const header = detail.lines.find((l) => l.type === "header") as TraceHeader | undefined;
  const invocation = detail.lines.find((l) => l.type === "invocation") as
    TraceInvocation | undefined;
  const prompt = detail.lines.find((l) => l.type === "prompt") as TracePrompt | undefined;
  const userMessage = detail.lines.find((l) => l.type === "user_message") as
    TraceUserMessage | undefined;
  const memorySearch = detail.lines.find((l) => l.type === "memory_search") as
    TraceMemorySearch | undefined;
  const currentContextFilter = detail.lines.find((l) => l.type === "current_context_filter") as
    TraceCurrentContextFilter | undefined;
  const autoClassifier = detail.lines.find((l) => l.type === "auto_classifier") as
    TraceAutoClassifier | undefined;
  const embeddingResult = detail.lines.find((l) => l.type === "embedding_result") as
    TraceEmbeddingResult | undefined;
  const profileUpdate = detail.lines.find((l) => l.type === "profile_update") as
    TraceProfileUpdate | undefined;
  const footer = detail.lines.find((l) => l.type === "footer") as TraceFooter | undefined;

  // Get all events (raw + normalized) and filter based on toggle
  // Backward compat: old traces used "raw"/"normalized"/"harness_event" type names
  const rawTypes = new Set(["raw_event", "raw", "harness_event"]);
  const normTypes = new Set(["normalized_event", "normalized"]);
  const allEvents = detail.lines.filter((l) => rawTypes.has(l.type) || normTypes.has(l.type)) as (
    TraceRawEvent | TraceNormalizedEvent
  )[];
  const filteredEvents = showRaw ? allEvents : allEvents.filter((e) => normTypes.has(e.type));

  return (
    <div className="p-4 space-y-4">
      {/* Header Section */}
      {header && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded text-xs">
              {header.channel}
            </span>
            <span className="text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded text-xs font-mono">
              {header.model}
            </span>
            {header.harness && (
              <span className="text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded text-xs font-mono">
                {header.harness}
              </span>
            )}
            <span className="text-neutral-400 text-sm">
              {new Date(header.timestamp).toLocaleString()}
            </span>
            {footer && (
              <span
                className={`ml-auto px-2 py-0.5 rounded text-xs ${footer.success ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}
              >
                {footer.success ? "✓ Success" : "✗ Error"}
              </span>
            )}
          </div>
          <div className="text-neutral-300 font-mono text-sm mt-2">{header.session_id}</div>
          {footer && (
            <div className="flex items-center gap-4 mt-3 text-xs text-neutral-500 flex-wrap">
              <span>
                Duration: <span className="text-neutral-300">{formatMs(footer.duration_ms)}</span>
              </span>
              <span>
                Messages: <span className="text-neutral-300">{footer.message_count}</span>
              </span>
              <span>
                Tool calls: <span className="text-neutral-300">{footer.tool_calls}</span>
              </span>
              {footer.usage && (
                <>
                  <span>
                    Tokens:{" "}
                    <span className="text-neutral-300">
                      {footer.usage.totalTokens.toLocaleString()}
                    </span>
                  </span>
                  <span>
                    Cost:{" "}
                    <span className="text-neutral-300">${footer.usage.cost.total.toFixed(4)}</span>
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Invocation */}
      {invocation && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
          <button
            className="w-full px-4 py-2 flex items-center justify-between text-left bg-neutral-800/50 hover:bg-neutral-800 transition-colors"
            onClick={() => toggleSection("invocation")}
          >
            <span className="text-sm font-medium text-neutral-300">CLI Command</span>
            <span className="text-neutral-500">
              {expandedSections.has("invocation") ? "−" : "+"}
            </span>
          </button>
          {expandedSections.has("invocation") && (
            <pre className="p-4 text-xs text-neutral-400 font-mono overflow-x-auto whitespace-pre-wrap break-all">
              {invocation.command}
            </pre>
          )}
        </div>
      )}

      {/* User Message */}
      {userMessage && (
        <div className="bg-blue-950/30 border border-blue-900/50 rounded-lg p-4">
          <div className="text-xs text-blue-400 mb-2 font-medium">User Message</div>
          <div className="text-neutral-200 whitespace-pre-wrap break-words">
            {userMessage.content || "(empty)"}
          </div>
          {userMessage.attachments && userMessage.attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {userMessage.attachments.map((a, i) => (
                <span key={i} className="bg-blue-900/30 text-blue-300 px-2 py-0.5 rounded text-xs">
                  📎 {a.type}: {a.path}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <TraceMemorySections
        memorySearch={memorySearch}
        currentContextFilter={currentContextFilter}
        autoClassifier={autoClassifier}
        embeddingResult={embeddingResult}
        profileUpdate={profileUpdate}
        expandedSections={expandedSections}
        toggleSection={toggleSection}
        openTrace={openTrace}
      />

      {/* System Prompt */}
      {prompt && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
          <button
            className="w-full px-4 py-2 flex items-center justify-between text-left bg-neutral-800/50 hover:bg-neutral-800 transition-colors"
            onClick={() => toggleSection("prompt")}
          >
            <span className="text-sm font-medium text-neutral-300">
              System Prompt{" "}
              <span className="text-neutral-500 font-normal">
                ({prompt.length.toLocaleString()} chars)
              </span>
            </span>
            <span className="text-neutral-500">{expandedSections.has("prompt") ? "−" : "+"}</span>
          </button>
          {expandedSections.has("prompt") && (
            <pre className="p-4 text-xs text-neutral-400 font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-[500px] overflow-y-auto">
              {prompt.content}
            </pre>
          )}
        </div>
      )}

      {/* Events Section */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
        <div className="px-4 py-2 bg-neutral-800/50 flex items-center justify-between">
          <span className="text-sm font-medium text-neutral-300">
            Events ({filteredEvents.length})
          </span>
          <label className="flex items-center gap-2 text-xs text-neutral-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showRaw}
              onChange={(e) => onShowRawChange(e.target.checked)}
              className="accent-blue-600 cursor-pointer w-3 h-3"
            />
            Show raw
          </label>
        </div>
        <div className="divide-y divide-neutral-800">
          <TraceEvents
            events={filteredEvents}
            expandedSections={expandedSections}
            toggleSection={toggleSection}
          />
        </div>
      </div>

      {/* Error */}
      {footer?.error && (
        <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-4">
          <div className="text-xs text-red-400 mb-1 font-medium">Error</div>
          <div className="text-red-300 font-mono text-sm">{footer.error}</div>
        </div>
      )}
    </div>
  );
}
