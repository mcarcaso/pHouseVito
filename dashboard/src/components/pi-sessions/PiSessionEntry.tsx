import type {
  BranchSummaryEntry,
  CompactionEntry,
  ModelChangeEntry,
  SessionEntryBase,
  SessionInfoEntry,
  SessionLine,
  SessionMessageEntry,
  ThinkingLevelChangeEntry,
} from "./pi-session-types";
import { extractMessageText, roleBadgeColor, roleColor } from "./pi-session-utils";

export default function PiSessionEntry({
  line,
  index,
  expanded,
  showRaw,
  onToggle,
}: {
  line: SessionLine;
  index: number;
  expanded: boolean;
  showRaw: boolean;
  onToggle: () => void;
}) {
  const i = index;
  const key = `${line.type}-${i}`;

  switch (line.type) {
    case "message": {
      const entry = line as SessionMessageEntry;
      const role = entry.message?.role || "unknown";
      const text = extractMessageText(entry.message?.content);
      const usage = entry.message?.usage;
      const isExpanded = expanded;
      const previewText = (text || "").replace(/\s+/g, " ").trim();
      const preview = previewText.length > 120 ? previewText.slice(0, 120) + "…" : previewText;

      if (!isExpanded) {
        // Collapsed: single-line summary. Click to expand.
        return (
          <div
            key={key}
            className={`rounded-lg border px-3 py-2 cursor-pointer hover:brightness-125 transition-all ${roleColor(role)}`}
            onClick={() => onToggle()}
          >
            <div className="flex items-center gap-2 text-xs">
              <span className={`px-2 py-0.5 rounded font-mono shrink-0 ${roleBadgeColor(role)}`}>
                {role}
              </span>
              <span className="text-neutral-500 font-mono shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className="font-mono truncate flex-1 opacity-80">
                {preview || <span className="text-neutral-600 italic">(empty)</span>}
              </span>
              <span className="text-neutral-500 shrink-0">▶</span>
            </div>
          </div>
        );
      }

      return (
        <div key={key} className={`rounded-lg border p-3 ${roleColor(role)}`}>
          <div
            className="flex items-center gap-2 flex-wrap mb-2 cursor-pointer"
            onClick={() => onToggle()}
          >
            <span className={`text-xs px-2 py-0.5 rounded font-mono ${roleBadgeColor(role)}`}>
              {role}
            </span>
            <span className="text-xs text-neutral-500 font-mono">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            {usage && (usage.cacheRead || usage.cacheWrite) ? (
              <span className="text-xs text-neutral-500">
                {usage.cacheRead ? (
                  <>
                    cacheR:{" "}
                    <span className="text-emerald-300">
                      {usage.cacheRead.toLocaleString()}
                    </span>{" "}
                  </>
                ) : null}
                {usage.cacheWrite ? (
                  <>
                    cacheW:{" "}
                    <span className="text-amber-300">{usage.cacheWrite.toLocaleString()}</span>
                  </>
                ) : null}
              </span>
            ) : null}
            <span className="text-neutral-500 ml-auto text-xs">▼</span>
          </div>
          <div className="text-sm whitespace-pre-wrap break-words font-mono">
            {text || <span className="text-neutral-600 italic">(empty)</span>}
          </div>
          {showRaw && (
            <pre className="mt-2 text-xs text-neutral-500 bg-neutral-950/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-60">
              {JSON.stringify(entry.message, null, 2)}
            </pre>
          )}
        </div>
      );
    }

    case "model_change": {
      const entry = line as ModelChangeEntry;
      return (
        <div
          key={key}
          className="rounded-lg border border-violet-900/30 bg-violet-950/10 px-3 py-2 text-xs flex items-center gap-2 flex-wrap"
        >
          <span className="bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded font-mono">
            model_change
          </span>
          <span className="text-violet-200 font-mono">
            {entry.provider}/{entry.modelId}
          </span>
          <span className="text-neutral-500 ml-auto">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>
        </div>
      );
    }

    case "thinking_level_change": {
      const entry = line as ThinkingLevelChangeEntry;
      return (
        <div
          key={key}
          className="rounded-lg border border-amber-900/30 bg-amber-950/10 px-3 py-2 text-xs flex items-center gap-2 flex-wrap"
        >
          <span className="bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-mono">
            thinking
          </span>
          <span className="text-amber-200 font-mono">{entry.thinkingLevel}</span>
          <span className="text-neutral-500 ml-auto">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>
        </div>
      );
    }

    case "compaction": {
      const entry = line as CompactionEntry;
      const isExpanded = expanded;
      const summary = (entry.summary || "").replace(/\s+/g, " ").trim();
      const preview = summary.length > 120 ? summary.slice(0, 120) + "…" : summary;

      if (!isExpanded) {
        return (
          <div
            key={key}
            className="rounded-lg border border-cyan-900/40 bg-cyan-950/10 px-3 py-2 cursor-pointer hover:brightness-125 transition-all"
            onClick={() => onToggle()}
          >
            <div className="flex items-center gap-2 text-xs">
              <span className="bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded font-mono shrink-0">
                compaction
              </span>
              <span className="text-neutral-500 shrink-0">
                tokensBefore: {entry.tokensBefore.toLocaleString()}
              </span>
              <span className="text-cyan-100/70 truncate flex-1">
                {preview || <span className="text-neutral-600 italic">(empty)</span>}
              </span>
              <span className="text-neutral-500 shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className="text-neutral-500 shrink-0">▶</span>
            </div>
          </div>
        );
      }

      return (
        <div key={key} className="rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-3 text-sm">
          <div
            className="flex items-center gap-2 flex-wrap mb-2 cursor-pointer"
            onClick={() => onToggle()}
          >
            <span className="bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded text-xs font-mono">
              compaction
            </span>
            <span className="text-xs text-neutral-500">
              tokensBefore: {entry.tokensBefore.toLocaleString()}
            </span>
            <span className="text-xs text-neutral-500 ml-auto">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            <span className="text-xs text-neutral-500">▼</span>
          </div>
          <div className="text-cyan-100/80 whitespace-pre-wrap text-xs">{entry.summary}</div>
        </div>
      );
    }

    case "branch_summary": {
      const entry = line as BranchSummaryEntry;
      const isExpanded = expanded;
      const summary = (entry.summary || "").replace(/\s+/g, " ").trim();
      const preview = summary.length > 120 ? summary.slice(0, 120) + "…" : summary;

      if (!isExpanded) {
        return (
          <div
            key={key}
            className="rounded-lg border border-orange-900/40 bg-orange-950/10 px-3 py-2 cursor-pointer hover:brightness-125 transition-all"
            onClick={() => onToggle()}
          >
            <div className="flex items-center gap-2 text-xs">
              <span className="bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded font-mono shrink-0">
                branch_summary
              </span>
              <span className="text-neutral-500 font-mono shrink-0">
                from {entry.fromId.slice(0, 8)}…
              </span>
              <span className="text-orange-100/70 truncate flex-1">
                {preview || <span className="text-neutral-600 italic">(empty)</span>}
              </span>
              <span className="text-neutral-500 shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className="text-neutral-500 shrink-0">▶</span>
            </div>
          </div>
        );
      }

      return (
        <div
          key={key}
          className="rounded-lg border border-orange-900/40 bg-orange-950/10 p-3 text-sm"
        >
          <div
            className="flex items-center gap-2 flex-wrap mb-2 cursor-pointer"
            onClick={() => onToggle()}
          >
            <span className="bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded text-xs font-mono">
              branch_summary
            </span>
            <span className="text-xs text-neutral-500 font-mono break-all">
              from {entry.fromId}
            </span>
            <span className="text-xs text-neutral-500 ml-auto">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            <span className="text-xs text-neutral-500">▼</span>
          </div>
          <div className="text-orange-100/80 whitespace-pre-wrap text-xs">{entry.summary}</div>
        </div>
      );
    }

    case "session_info": {
      const entry = line as SessionInfoEntry;
      return (
        <div
          key={key}
          className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs flex items-center gap-2 flex-wrap"
        >
          <span className="bg-neutral-700 text-neutral-300 px-2 py-0.5 rounded font-mono">
            session_info
          </span>
          <span className="text-neutral-300">{entry.name || "(unnamed)"}</span>
          <span className="text-neutral-500 ml-auto">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>
        </div>
      );
    }

    case "label":
    case "custom":
    case "custom_message": {
      if (!showRaw) return null;
      return (
        <div
          key={key}
          className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-neutral-700 text-neutral-300 px-2 py-0.5 rounded font-mono">
              {line.type}
            </span>
            <span className="text-neutral-500 ml-auto">
              {new Date((line as SessionEntryBase).timestamp).toLocaleTimeString()}
            </span>
          </div>
          <pre className="text-neutral-400 font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-60">
            {JSON.stringify(line, null, 2)}
          </pre>
        </div>
      );
    }

    case "parse_error": {
      const entry = line as { type: "parse_error"; raw: string };
      return (
        <div
          key={key}
          className="rounded-lg border border-red-900/40 bg-red-950/10 px-3 py-2 text-xs"
        >
          <span className="bg-red-500/20 text-red-300 px-2 py-0.5 rounded font-mono mr-2">
            parse_error
          </span>
          <span className="text-red-300/70 font-mono break-all">{entry.raw.slice(0, 200)}</span>
        </div>
      );
    }

    default: {
      if (!showRaw) return null;
      return (
        <div
          key={key}
          className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="bg-neutral-700 text-neutral-300 px-2 py-0.5 rounded font-mono">
              {line.type}
            </span>
          </div>
          <pre className="text-neutral-400 font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-60">
            {JSON.stringify(line, null, 2)}
          </pre>
        </div>
      );
    }
  }
}
