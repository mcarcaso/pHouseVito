import type { PiSessionListItem } from "../../hooks/usePiSessions";
import { formatDate, formatSize } from "./pi-session-utils";

export default function PiSessionList({
  list,
  autoRefresh,
  onAutoRefreshChange,
  onRefresh,
  onOpen,
  onDelete,
  onDeleteAll,
}: {
  list: PiSessionListItem[];
  autoRefresh: boolean;
  onAutoRefreshChange: (value: boolean) => void;
  onRefresh: () => void;
  onOpen: (rel: string) => void;
  onDelete: (rel: string) => void;
  onDeleteAll: () => void;
}) {
  return (
    <div className="flex flex-col pb-8">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white flex-1">Pi Sessions ({list.length})</h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-neutral-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => onAutoRefreshChange(e.target.checked)}
              className="accent-blue-600 cursor-pointer w-3.5 h-3.5"
            />
            Auto
          </label>
          <button
            className="w-8 h-8 flex items-center justify-center rounded-md border bg-neutral-900 border-neutral-800 text-neutral-400 hover:bg-neutral-800 hover:border-neutral-700 text-lg cursor-pointer transition-all"
            onClick={onRefresh}
            title="Refresh"
          >
            ↻
          </button>
          {list.length > 0 && (
            <button
              className="px-3 h-8 flex items-center justify-center rounded-md border bg-neutral-900 border-neutral-800 text-red-400 hover:bg-red-950 hover:border-red-800 text-xs cursor-pointer transition-all"
              onClick={onDeleteAll}
              title="Delete all pi sessions"
            >
              Delete All
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-2">
        {list.map((item) => (
          <div
            key={item.rel}
            className="bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 cursor-pointer transition-all hover:bg-neutral-850 hover:border-neutral-700 active:scale-[0.99] group"
            onClick={() => onOpen(item.rel)}
          >
            <div className="flex items-center gap-3 mb-2 text-sm flex-wrap">
              {item.lastModel && (
                <span className="text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded text-xs font-mono">
                  {item.lastModel}
                </span>
              )}
              <span className="text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded text-xs">
                JSONL
              </span>
              {item.messageCount !== null && (
                <span className="text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded text-xs">
                  {item.messageCount} msgs
                </span>
              )}
              <span className="text-neutral-600 text-xs">{formatSize(item.size)}</span>
              <span className="text-neutral-600 ml-auto text-xs">{formatDate(item.mtime)}</span>
              <button
                className="w-6 h-6 flex items-center justify-center rounded border bg-neutral-900 border-neutral-700 text-red-400 hover:bg-red-950 hover:border-red-800 text-xs cursor-pointer transition-all opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(item.rel);
                }}
                title="Delete pi session"
              >
                ✕
              </button>
            </div>
            <div className="text-neutral-300 text-sm leading-relaxed">
              {item.alias || item.vitoSessionId || item.rel}
            </div>
            {item.alias && item.vitoSessionId && (
              <div className="text-neutral-600 text-xs font-mono mt-1 truncate">
                {item.vitoSessionId}
              </div>
            )}
            {item.lastUserMessage && (
              <div className="text-neutral-400 text-sm mt-2 line-clamp-2">
                {item.lastUserMessage}
              </div>
            )}
          </div>
        ))}
        {list.length === 0 && (
          <div className="text-center text-neutral-500 py-12">
            No Pi sessions yet. Send a message to start one.
          </div>
        )}
      </div>
    </div>
  );
}
