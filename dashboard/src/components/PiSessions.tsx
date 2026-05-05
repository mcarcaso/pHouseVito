import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

// ── Types mirroring pi's session-manager.d.ts ───────────────────────────────

interface SessionHeader {
  type: 'session';
  id: string;
  timestamp: string;
  cwd: string;
  version?: number;
  parentSession?: string;
}

interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

interface SessionMessageEntry extends SessionEntryBase {
  type: 'message';
  message: AgentMessage;
}

interface ModelChangeEntry extends SessionEntryBase {
  type: 'model_change';
  provider: string;
  modelId: string;
}

interface ThinkingLevelChangeEntry extends SessionEntryBase {
  type: 'thinking_level_change';
  thinkingLevel: string;
}

interface CompactionEntry extends SessionEntryBase {
  type: 'compaction';
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
}

interface BranchSummaryEntry extends SessionEntryBase {
  type: 'branch_summary';
  fromId: string;
  summary: string;
}

interface CustomEntry extends SessionEntryBase {
  type: 'custom';
  customType: string;
  data?: unknown;
}

interface CustomMessageEntry extends SessionEntryBase {
  type: 'custom_message';
  customType: string;
  content: unknown;
  display: boolean;
}

interface SessionInfoEntry extends SessionEntryBase {
  type: 'session_info';
  name?: string;
}

interface LabelEntry extends SessionEntryBase {
  type: 'label';
  targetId: string;
  label: string | undefined;
}

type SessionLine =
  | SessionHeader
  | SessionMessageEntry
  | ModelChangeEntry
  | ThinkingLevelChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | SessionInfoEntry
  | LabelEntry
  | { type: 'parse_error'; raw: string }
  | (SessionEntryBase & { type: string });

// Pi messages roughly follow OpenAI/Anthropic shape.
interface AgentMessage {
  role: 'user' | 'assistant' | 'tool' | string;
  content?: unknown;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
    cost?: { total?: number };
  };
  [key: string]: unknown;
}

interface PiSessionListItem {
  rel: string;
  size: number;
  mtime: number;
  vitoSessionId: string;
  alias: string | null;
  piSessionId: string;
  piTimestamp: string;
  piCwd: string;
  messageCount: number;
  lastModel: string;
  firstUserMessage: string;
}

interface PiSessionDetail {
  rel: string;
  format: 'jsonl';
  lines: SessionLine[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const formatDate = (ts: number) => new Date(ts).toLocaleString();
const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
};

/** Best-effort plain-text extraction from a pi message's content field. */
function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (typeof b.text === 'string') parts.push(b.text);
      else if (typeof b.thinking === 'string') parts.push(b.thinking);
      else if (b.type === 'tool_use' && typeof b.name === 'string') {
        parts.push(`[tool_use: ${b.name}]`);
      } else if (b.type === 'tool_result') {
        const result = b.content;
        if (typeof result === 'string') parts.push(`[tool_result] ${result}`);
        else parts.push('[tool_result]');
      }
    }
    return parts.join('\n\n');
  }
  return '';
}

function roleColor(role: string): string {
  switch (role) {
    case 'user': return 'bg-blue-950/30 border-blue-900/50 text-blue-100';
    case 'assistant': return 'bg-violet-950/30 border-violet-900/50 text-violet-100';
    case 'tool': return 'bg-emerald-950/20 border-emerald-900/40 text-emerald-100';
    default: return 'bg-neutral-900 border-neutral-800 text-neutral-200';
  }
}

function roleBadgeColor(role: string): string {
  switch (role) {
    case 'user': return 'bg-blue-500/20 text-blue-300';
    case 'assistant': return 'bg-violet-500/20 text-violet-300';
    case 'tool': return 'bg-emerald-500/20 text-emerald-300';
    default: return 'bg-neutral-700 text-neutral-300';
  }
}

// ── Component ───────────────────────────────────────────────────────────────

function PiSessions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedRel = searchParams.get('file');

  const [list, setList] = useState<PiSessionListItem[]>([]);
  const [detail, setDetail] = useState<PiSessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showRaw, setShowRaw] = useState(false);

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch('/api/pi-sessions');
      const data = await res.json();
      setList(Array.isArray(data) ? data : data.files || []);
    } catch (err) {
      console.error('Failed to fetch pi sessions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDetail = useCallback(async (rel: string) => {
    try {
      // rel is a path-like "encoded-vito/<pi-session>.jsonl". Each segment
      // needs to be encoded for the URL but the slashes between them must
      // remain literal so Express's wildcard matches.
      const path = rel.split('/').map(encodeURIComponent).join('/');
      const res = await fetch(`/api/pi-sessions/${path}`);
      const data = await res.json();
      setDetail(data);
    } catch (err) {
      console.error('Failed to fetch pi session:', err);
    }
  }, []);

  const deleteFile = useCallback(async (rel: string) => {
    if (!confirm(`Delete pi session "${rel}"?`)) return;
    try {
      const path = rel.split('/').map(encodeURIComponent).join('/');
      await fetch(`/api/pi-sessions/${path}`, { method: 'DELETE' });
      if (selectedRel === rel) {
        setSearchParams({});
        setDetail(null);
      }
      fetchList();
    } catch (err) {
      console.error('Failed to delete pi session:', err);
    }
  }, [selectedRel, setSearchParams, fetchList]);

  const deleteAll = useCallback(async () => {
    if (!confirm(`Delete ALL ${list.length} pi sessions? This cannot be undone.`)) return;
    try {
      await fetch('/api/pi-sessions', { method: 'DELETE' });
      fetchList();
    } catch (err) {
      console.error('Failed to delete pi sessions:', err);
    }
  }, [list.length, fetchList]);

  useEffect(() => {
    if (selectedRel) {
      setDetail(null);
      fetchDetail(selectedRel);
    } else {
      fetchList();
    }
  }, [selectedRel, fetchDetail, fetchList]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (selectedRel) {
        fetchDetail(selectedRel);
      } else {
        fetchList();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedRel, fetchDetail, fetchList]);

  // ── Detail view ──────────────────────────────────────────────────────────

  const renderDetail = (d: PiSessionDetail) => {
    const header = d.lines.find((l) => l.type === 'session') as SessionHeader | undefined;

    // Categorize entries
    const messages: SessionMessageEntry[] = [];
    const modelChanges: ModelChangeEntry[] = [];
    const thinkingChanges: ThinkingLevelChangeEntry[] = [];
    const compactions: CompactionEntry[] = [];
    const branchSummaries: BranchSummaryEntry[] = [];
    const customEntries: CustomEntry[] = [];
    const customMessages: CustomMessageEntry[] = [];
    const sessionInfos: SessionInfoEntry[] = [];
    const labels: LabelEntry[] = [];
    const others: SessionLine[] = [];

    for (const line of d.lines) {
      switch (line.type) {
        case 'session': break;
        case 'message': messages.push(line as SessionMessageEntry); break;
        case 'model_change': modelChanges.push(line as ModelChangeEntry); break;
        case 'thinking_level_change': thinkingChanges.push(line as ThinkingLevelChangeEntry); break;
        case 'compaction': compactions.push(line as CompactionEntry); break;
        case 'branch_summary': branchSummaries.push(line as BranchSummaryEntry); break;
        case 'custom': customEntries.push(line as CustomEntry); break;
        case 'custom_message': customMessages.push(line as CustomMessageEntry); break;
        case 'session_info': sessionInfos.push(line as SessionInfoEntry); break;
        case 'label': labels.push(line as LabelEntry); break;
        default:
          if (line.type !== 'parse_error') others.push(line);
      }
    }

    // Aggregate usage from assistant messages
    let totalIn = 0, totalOut = 0, totalCacheRead = 0, totalCacheWrite = 0, totalCost = 0;
    let assistantCount = 0;
    for (const m of messages) {
      if (m.message?.role === 'assistant') assistantCount++;
      const u = m.message?.usage;
      if (u) {
        totalIn += u.input || 0;
        totalOut += u.output || 0;
        totalCacheRead += u.cacheRead || 0;
        totalCacheWrite += u.cacheWrite || 0;
        totalCost += u.cost?.total || 0;
      }
    }

    const sessionName = sessionInfos.length > 0 ? sessionInfos[sessionInfos.length - 1].name : undefined;
    const currentModel = modelChanges.length > 0
      ? `${modelChanges[modelChanges.length - 1].provider}/${modelChanges[modelChanges.length - 1].modelId}`
      : '';

    return (
      <div className="p-4 space-y-4">
        {/* Header card */}
        {header && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded text-xs font-mono">
                pi v{header.version ?? '?'}
              </span>
              {currentModel && (
                <span className="text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded text-xs font-mono">
                  {currentModel}
                </span>
              )}
              {sessionName && (
                <span className="text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded text-xs">
                  {sessionName}
                </span>
              )}
              <span className="text-neutral-400 text-sm">
                {new Date(header.timestamp).toLocaleString()}
              </span>
            </div>
            <div className="text-neutral-300 font-mono text-sm mt-2 break-all">
              {header.id}
            </div>
            <div className="text-neutral-500 text-xs font-mono mt-1 break-all">
              cwd: {header.cwd}
            </div>
            <div className="flex items-center gap-4 mt-3 text-xs text-neutral-500 flex-wrap">
              <span>Messages: <span className="text-neutral-300">{messages.length}</span></span>
              <span>Assistant turns: <span className="text-neutral-300">{assistantCount}</span></span>
              <span>Model changes: <span className="text-neutral-300">{modelChanges.length}</span></span>
              <span>Compactions: <span className="text-neutral-300">{compactions.length}</span></span>
              {totalIn + totalOut > 0 && (
                <>
                  <span>In: <span className="text-neutral-300">{totalIn.toLocaleString()}</span></span>
                  <span>Out: <span className="text-neutral-300">{totalOut.toLocaleString()}</span></span>
                  <span>CacheR: <span className="text-emerald-300">{totalCacheRead.toLocaleString()}</span></span>
                  <span>CacheW: <span className="text-amber-300">{totalCacheWrite.toLocaleString()}</span></span>
                </>
              )}
              {totalCost > 0 && (
                <span>Cost: <span className="text-neutral-300">${totalCost.toFixed(4)}</span></span>
              )}
            </div>
          </div>
        )}

        {/* Conversation timeline */}
        <div className="space-y-3">
          {d.lines.filter((l) => l.type !== 'session').map((line, i) => renderEntry(line, i))}
        </div>

        {showRaw && others.length === 0 && customEntries.length === 0 && labels.length === 0 ? null : null}
      </div>
    );
  };

  const renderEntry = (line: SessionLine, i: number) => {
    const key = `${line.type}-${i}`;

    switch (line.type) {
      case 'message': {
        const entry = line as SessionMessageEntry;
        const role = entry.message?.role || 'unknown';
        const text = extractMessageText(entry.message?.content);
        const usage = entry.message?.usage;
        return (
          <div key={key} className={`rounded-lg border p-3 ${roleColor(role)}`}>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className={`text-xs px-2 py-0.5 rounded font-mono ${roleBadgeColor(role)}`}>
                {role}
              </span>
              <span className="text-xs text-neutral-500 font-mono">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              {usage && (usage.cacheRead || usage.cacheWrite) ? (
                <span className="text-xs text-neutral-500 ml-auto">
                  {usage.cacheRead ? <>cacheR: <span className="text-emerald-300">{usage.cacheRead.toLocaleString()}</span> </> : null}
                  {usage.cacheWrite ? <>cacheW: <span className="text-amber-300">{usage.cacheWrite.toLocaleString()}</span></> : null}
                </span>
              ) : null}
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

      case 'model_change': {
        const entry = line as ModelChangeEntry;
        return (
          <div key={key} className="rounded-lg border border-violet-900/30 bg-violet-950/10 px-3 py-2 text-xs flex items-center gap-2 flex-wrap">
            <span className="bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded font-mono">model_change</span>
            <span className="text-violet-200 font-mono">{entry.provider}/{entry.modelId}</span>
            <span className="text-neutral-500 ml-auto">{new Date(entry.timestamp).toLocaleTimeString()}</span>
          </div>
        );
      }

      case 'thinking_level_change': {
        const entry = line as ThinkingLevelChangeEntry;
        return (
          <div key={key} className="rounded-lg border border-amber-900/30 bg-amber-950/10 px-3 py-2 text-xs flex items-center gap-2 flex-wrap">
            <span className="bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-mono">thinking</span>
            <span className="text-amber-200 font-mono">{entry.thinkingLevel}</span>
            <span className="text-neutral-500 ml-auto">{new Date(entry.timestamp).toLocaleTimeString()}</span>
          </div>
        );
      }

      case 'compaction': {
        const entry = line as CompactionEntry;
        return (
          <div key={key} className="rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-3 text-sm">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded text-xs font-mono">compaction</span>
              <span className="text-xs text-neutral-500">tokensBefore: {entry.tokensBefore.toLocaleString()}</span>
              <span className="text-xs text-neutral-500 ml-auto">{new Date(entry.timestamp).toLocaleTimeString()}</span>
            </div>
            <div className="text-cyan-100/80 whitespace-pre-wrap text-xs">{entry.summary}</div>
          </div>
        );
      }

      case 'branch_summary': {
        const entry = line as BranchSummaryEntry;
        return (
          <div key={key} className="rounded-lg border border-orange-900/40 bg-orange-950/10 p-3 text-sm">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded text-xs font-mono">branch_summary</span>
              <span className="text-xs text-neutral-500 font-mono break-all">from {entry.fromId}</span>
              <span className="text-xs text-neutral-500 ml-auto">{new Date(entry.timestamp).toLocaleTimeString()}</span>
            </div>
            <div className="text-orange-100/80 whitespace-pre-wrap text-xs">{entry.summary}</div>
          </div>
        );
      }

      case 'session_info': {
        const entry = line as SessionInfoEntry;
        return (
          <div key={key} className="rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs flex items-center gap-2 flex-wrap">
            <span className="bg-neutral-700 text-neutral-300 px-2 py-0.5 rounded font-mono">session_info</span>
            <span className="text-neutral-300">{entry.name || '(unnamed)'}</span>
            <span className="text-neutral-500 ml-auto">{new Date(entry.timestamp).toLocaleTimeString()}</span>
          </div>
        );
      }

      case 'label':
      case 'custom':
      case 'custom_message': {
        if (!showRaw) return null;
        return (
          <div key={key} className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs">
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-neutral-700 text-neutral-300 px-2 py-0.5 rounded font-mono">{line.type}</span>
              <span className="text-neutral-500 ml-auto">{new Date((line as SessionEntryBase).timestamp).toLocaleTimeString()}</span>
            </div>
            <pre className="text-neutral-400 font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-60">
              {JSON.stringify(line, null, 2)}
            </pre>
          </div>
        );
      }

      case 'parse_error': {
        const entry = line as { type: 'parse_error'; raw: string };
        return (
          <div key={key} className="rounded-lg border border-red-900/40 bg-red-950/10 px-3 py-2 text-xs">
            <span className="bg-red-500/20 text-red-300 px-2 py-0.5 rounded font-mono mr-2">parse_error</span>
            <span className="text-red-300/70 font-mono break-all">{entry.raw.slice(0, 200)}</span>
          </div>
        );
      }

      default: {
        if (!showRaw) return null;
        return (
          <div key={key} className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-xs">
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-neutral-700 text-neutral-300 px-2 py-0.5 rounded font-mono">{line.type}</span>
            </div>
            <pre className="text-neutral-400 font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-60">
              {JSON.stringify(line, null, 2)}
            </pre>
          </div>
        );
      }
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  if (selectedRel && detail) {
    return (
      <div className="flex flex-col pb-8">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
          <button
            className="bg-transparent border-none text-blue-500 text-2xl cursor-pointer px-2 py-1 leading-none hover:text-blue-400"
            onClick={() => { setSearchParams({}); setDetail(null); }}
          >
            ‹
          </button>
          <h2 className="text-lg font-semibold text-white truncate flex-1 font-mono">{detail.rel}</h2>
          <label className="flex items-center gap-1.5 text-sm text-neutral-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showRaw}
              onChange={(e) => setShowRaw(e.target.checked)}
              className="accent-blue-600 cursor-pointer w-3.5 h-3.5"
            />
            Show raw
          </label>
          <label className="flex items-center gap-1.5 text-sm text-neutral-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-blue-600 cursor-pointer w-3.5 h-3.5"
            />
            Live
          </label>
          <button
            className="w-8 h-8 flex items-center justify-center rounded-md border bg-neutral-900 border-neutral-800 text-red-400 hover:bg-red-950 hover:border-red-800 text-sm cursor-pointer transition-all"
            onClick={() => deleteFile(detail.rel)}
            title="Delete pi session"
          >
            ✕
          </button>
        </div>
        {renderDetail(detail)}
      </div>
    );
  }

  if (selectedRel && !detail) {
    return <div className="flex flex-col pb-8 text-neutral-400 p-4">Loading pi session...</div>;
  }

  if (loading) {
    return <div className="flex flex-col pb-8 text-neutral-400 p-4">Loading pi sessions...</div>;
  }

  return (
    <div className="flex flex-col pb-8">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white flex-1">
          Pi Sessions ({list.length})
        </h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-neutral-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-blue-600 cursor-pointer w-3.5 h-3.5"
            />
            Auto
          </label>
          <button
            className="w-8 h-8 flex items-center justify-center rounded-md border bg-neutral-900 border-neutral-800 text-neutral-400 hover:bg-neutral-800 hover:border-neutral-700 text-lg cursor-pointer transition-all"
            onClick={fetchList}
            title="Refresh"
          >
            ↻
          </button>
          {list.length > 0 && (
            <button
              className="px-3 h-8 flex items-center justify-center rounded-md border bg-neutral-900 border-neutral-800 text-red-400 hover:bg-red-950 hover:border-red-800 text-xs cursor-pointer transition-all"
              onClick={deleteAll}
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
            onClick={() => setSearchParams({ file: item.rel })}
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
              <span className="text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded text-xs">
                {item.messageCount} msgs
              </span>
              <span className="text-neutral-600 text-xs">{formatSize(item.size)}</span>
              <span className="text-neutral-600 ml-auto text-xs">{formatDate(item.mtime)}</span>
              <button
                className="w-6 h-6 flex items-center justify-center rounded border bg-neutral-900 border-neutral-700 text-red-400 hover:bg-red-950 hover:border-red-800 text-xs cursor-pointer transition-all opacity-0 group-hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); deleteFile(item.rel); }}
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
            {item.firstUserMessage && (
              <div className="text-neutral-400 text-sm mt-2 line-clamp-2">
                {item.firstUserMessage}
              </div>
            )}
          </div>
        ))}
        {list.length === 0 && (
          <div className="text-center text-neutral-500 py-12">
            No pi sessions yet. Send a message via orchestrator v2 to start logging.
          </div>
        )}
      </div>
    </div>
  );
}

export default PiSessions;
