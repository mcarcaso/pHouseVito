import { useEffect, useState } from "react";
import type { LogFile } from "./trace-types";

const TRACE_TYPE_FILTER_STORAGE_KEY = "traces.traceTypeFilter";
const SESSION_FILTER_STORAGE_KEY = "traces.sessionFilter";

function parsePreview(preview: string) {
  let session = "";
  let channel = "";
  let model = "";
  for (const line of preview.split("\n")) {
    if (line.startsWith("Session:")) session = line.replace("Session:", "").trim();
    if (line.startsWith("Channel:")) channel = line.replace("Channel:", "").trim();
    if (line.startsWith("Model:")) model = line.replace("Model:", "").trim();
  }
  return { session, channel, model };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatCost(cost: number): string {
  if (cost < 0.0001) return "<$0.0001";
  return `$${cost.toFixed(4)}`;
}

function userMessage(log: LogFile): string {
  const message = log.userMessage || "";
  if (log.traceType !== "classifier" || !message.includes("<user-message>")) return message;
  return message.match(/<user-message>\s*([\s\S]*?)\s*<\/user-message>/)?.[1]?.trim() ?? message;
}

export default function TraceList({
  logs,
  loading,
  autoRefresh,
  onAutoRefreshChange,
  onRefresh,
  onOpen,
  onDelete,
  onDeleteAll,
}: {
  logs: LogFile[];
  loading: boolean;
  autoRefresh: boolean;
  onAutoRefreshChange: (value: boolean) => void;
  onRefresh: () => void;
  onOpen: (filename: string) => void;
  onDelete: (filename: string) => void;
  onDeleteAll: () => void;
}) {
  const [traceTypeFilter, setTraceTypeFilter] = useState(
    () => localStorage.getItem(TRACE_TYPE_FILTER_STORAGE_KEY) || "all",
  );
  const [sessionFilter, setSessionFilter] = useState(
    () => localStorage.getItem(SESSION_FILTER_STORAGE_KEY) || "all",
  );

  useEffect(
    () => localStorage.setItem(TRACE_TYPE_FILTER_STORAGE_KEY, traceTypeFilter),
    [traceTypeFilter],
  );
  useEffect(() => localStorage.setItem(SESSION_FILTER_STORAGE_KEY, sessionFilter), [sessionFilter]);

  const sessions = [
    ...new Set(
      logs.map((log) => log.sessionId || parsePreview(log.preview).session).filter(Boolean),
    ),
  ].sort();

  useEffect(() => {
    if (sessionFilter !== "all" && !sessions.includes(sessionFilter)) setSessionFilter("all");
  }, [sessionFilter, sessions]);

  if (loading)
    return <div className="flex flex-col pb-8 text-neutral-400 p-4">Loading traces...</div>;

  const filteredLogs = logs.filter((log) => {
    if (traceTypeFilter !== "all" && log.traceType !== traceTypeFilter) return false;
    return (
      sessionFilter === "all" ||
      (log.sessionId || parsePreview(log.preview).session) === sessionFilter
    );
  });

  return (
    <div className="flex flex-col pb-8">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white flex-1">
          Traces ({filteredLogs.length}
          {filteredLogs.length !== logs.length ? ` / ${logs.length}` : ""})
        </h2>
        <label className="flex items-center gap-1.5 text-sm text-neutral-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => onAutoRefreshChange(event.target.checked)}
            className="accent-blue-600 cursor-pointer w-3.5 h-3.5"
          />
          Auto
        </label>
        <button
          className="w-8 h-8 rounded-md border bg-neutral-900 border-neutral-800 text-neutral-400 hover:bg-neutral-800"
          onClick={onRefresh}
          title="Refresh"
        >
          ↻
        </button>
        {logs.length > 0 && (
          <button
            className="px-3 h-8 rounded-md border bg-neutral-900 border-neutral-800 text-red-400 hover:bg-red-950 text-xs"
            onClick={onDeleteAll}
          >
            Delete All
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 px-4 py-2 border-b border-neutral-800 bg-neutral-950/50">
        <label className="flex items-center gap-2 text-xs text-neutral-500">
          Type:
          <select
            value={traceTypeFilter}
            onChange={(event) => setTraceTypeFilter(event.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300"
          >
            <option value="all">All</option>
            <option value="main">Main</option>
            <option value="classifier">Classifier</option>
            <option value="profile">Profile</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-neutral-500">
          Session:
          <select
            value={sessionFilter}
            onChange={(event) => setSessionFilter(event.target.value)}
            className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300"
          >
            <option value="all">All</option>
            {sessions.map((session) => (
              <option key={session} value={session}>
                {session}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="p-4 space-y-2">
        {filteredLogs.map((log) => {
          const info = parsePreview(log.preview);
          const traceType = log.traceType || "main";
          return (
            <div
              key={log.filename}
              className="bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 cursor-pointer hover:border-neutral-700 group"
              onClick={() => onOpen(log.filename)}
            >
              <div className="flex items-center gap-3 mb-2 text-sm flex-wrap">
                {traceType === "classifier" && (
                  <span className="text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded text-xs border border-amber-500/30">
                    Classifier
                  </span>
                )}
                {traceType === "profile" && (
                  <span className="text-sky-400 bg-sky-500/20 px-2 py-0.5 rounded text-xs border border-sky-500/30">
                    Profile
                  </span>
                )}
                <span className="text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded text-xs">
                  {info.channel || "—"}
                </span>
                <span className="text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded text-xs font-mono">
                  {info.model || "—"}
                </span>
                <span className="text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded text-xs">
                  JSONL
                </span>
                {log.hasEmbedding && (
                  <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-xs">
                    Embedding
                  </span>
                )}
                <span className="text-neutral-600 text-xs">{formatSize(log.size)}</span>
                {typeof log.cost === "number" && (
                  <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-xs font-mono">
                    {formatCost(log.cost)}
                  </span>
                )}
                <span className="text-neutral-600 ml-auto text-xs">
                  {new Date(log.timestamp).toLocaleString()}
                </span>
                <button
                  className="w-6 h-6 rounded border bg-neutral-900 border-neutral-700 text-red-400 opacity-0 group-hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(log.filename);
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="text-neutral-300 text-sm">
                {log.alias || info.session || log.filename}
              </div>
              {log.alias && info.session && (
                <div className="text-neutral-600 text-xs font-mono mt-1 truncate">
                  {info.session}
                </div>
              )}
              {userMessage(log) && (
                <div className="text-neutral-400 text-sm mt-2 line-clamp-2">{userMessage(log)}</div>
              )}
            </div>
          );
        })}
        {filteredLogs.length === 0 && (
          <div className="text-center text-neutral-500 py-12">
            {logs.length
              ? "No traces match your filters."
              : "No traces yet. Send a message to start logging."}
          </div>
        )}
      </div>
    </div>
  );
}
