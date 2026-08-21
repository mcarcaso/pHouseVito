import type { TraceNormalizedEvent, TraceRawEvent } from "./trace-types";
import { formatMs } from "./trace-utils";

export default function TraceEvents({
  events,
  expandedSections,
  toggleSection,
}: {
  events: (TraceRawEvent | TraceNormalizedEvent)[];
  expandedSections: Set<string>;
  toggleSection: (key: string) => void;
}) {
  return events.map((e, i) => {
    const key = `event-${i}`;
    const isExpanded = expandedSections.has(key);

    const isRaw = e.type === "raw_event";

    // Try to get an event label - don't assume anything about the structure
    let eventLabel = "—";
    let eventStr = "";

    try {
      // Try to stringify it - might not be JSON
      if (typeof e.event === "string") {
        eventStr = e.event;
      } else if (e.event === null || e.event === undefined) {
        eventStr = String(e.event);
      } else {
        eventStr = JSON.stringify(e.event, null, 2);
      }

      // Try to extract a type/kind label if it's an object with that property
      if (e.event && typeof e.event === "object" && !Array.isArray(e.event)) {
        const obj = e.event as Record<string, unknown>;
        if (typeof obj.type === "string") {
          eventLabel = obj.type;
        } else if (typeof obj.kind === "string") {
          eventLabel = obj.kind;
        }
      }
    } catch {
      // If stringify fails, just show what we can
      eventStr = String(e.event);
    }

    const preview = eventStr.length > 100 ? eventStr.slice(0, 100) + "…" : eventStr;

    return (
      <div key={key} className="px-4 py-2 hover:bg-neutral-800/30">
        <div
          className="flex items-center gap-2 cursor-pointer select-none"
          onClick={() => toggleSection(key)}
        >
          <span className="text-xs text-neutral-600 font-mono w-16">{formatMs(e.ts)}</span>
          <span
            className={`text-xs px-2 py-0.5 rounded font-mono ${isRaw ? "bg-neutral-700 text-neutral-400" : "bg-blue-900/50 text-blue-400"}`}
          >
            {isRaw ? "raw" : "norm"}
          </span>
          <span className="text-xs text-neutral-300 font-mono">{eventLabel}</span>
          {!isExpanded && (
            <span className="text-xs text-neutral-600 font-mono truncate flex-1">
              {preview.replace(/\n/g, " ")}
            </span>
          )}
          <span className="text-neutral-600 text-xs">{isExpanded ? "▼" : "▶"}</span>
        </div>
        {isExpanded && (
          <pre className="mt-2 text-xs text-neutral-400 font-mono overflow-x-auto whitespace-pre-wrap break-words bg-neutral-800/50 p-2 rounded ml-16 max-h-[400px] overflow-y-auto">
            {eventStr}
          </pre>
        )}
      </div>
    );
  });
}
