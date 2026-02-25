import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

// ══════════════════════════════════════════════════════════════════════════════
// TRACE LINE TYPES — Matches src/traceTypes.ts
// ══════════════════════════════════════════════════════════════════════════════

interface TraceHeader {
  type: "header";
  timestamp: string;
  session_id: string;
  channel: string;
  target: string;
  model: string;
  harness: string;
}

interface TraceInvocation {
  type: "invocation";
  command: string;
}

interface TracePrompt {
  type: "prompt";
  content: string;
  length: number;
}

interface TraceUserMessage {
  type: "user_message";
  content: string;
  attachments?: { type: string; path: string }[];
}

// Raw event — exactly what the harness emitted
interface TraceRawEvent {
  type: "raw_event";
  ts: number;
  event: unknown;
}

// Normalized event — our harness-agnostic format
interface TraceNormalizedEvent {
  type: "normalized_event";
  ts: number;
  event: unknown;
}

interface TraceMemorySearch {
  type: "memory_search";
  query: string;
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
  }[];
  skipped?: string;
}

interface TraceEmbeddingResult {
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

interface TraceProfileUpdate {
  type: "profile_update";
  skipped?: string;
  updates_applied: number;
  updates: {
    path: string;
    action: string;
    value: unknown;
  }[];
  duration_ms: number;
}

interface TraceFooter {
  type: "footer";
  duration_ms: number;
  message_count: number;
  tool_calls: number;
  success: boolean;
  error?: string;
}

type TraceLine = TraceHeader | TraceInvocation | TracePrompt | TraceUserMessage | TraceRawEvent | TraceNormalizedEvent | TraceMemorySearch | TraceEmbeddingResult | TraceProfileUpdate | TraceFooter;

interface LogFile {
  filename: string;
  timestamp: number;
  size: number;
  preview: string;
  format?: "jsonl" | "text";
  sessionId?: string;
  alias?: string | null;
  hasEmbedding?: boolean;
}

interface LogDetailJsonl {
  filename: string;
  format: "jsonl";
  lines: TraceLine[];
}

interface LogDetailText {
  filename: string;
  format: "text";
  content: string;
}

type LogDetail = LogDetailJsonl | LogDetailText;

function Traces() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedLog = searchParams.get('file');

  const [logs, setLogs] = useState<LogFile[]>([]);
  const [logDetail, setLogDetail] = useState<LogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [showRaw, setShowRaw] = useState(false); // Hide raw events by default

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/logs?limit=100');
      const data = await res.json();
      setLogs(data);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLogDetail = useCallback(async (filename: string) => {
    try {
      const res = await fetch(`/api/logs/${encodeURIComponent(filename)}`);
      const data = await res.json();
      setLogDetail(data);
    } catch (err) {
      console.error('Failed to fetch log detail:', err);
    }
  }, []);

  const deleteLog = useCallback(async (filename: string) => {
    if (!confirm(`Delete trace "${filename}"?`)) return;
    try {
      await fetch(`/api/logs/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      // If we're viewing this log, go back to list
      if (selectedLog === filename) {
        setSearchParams({});
        setLogDetail(null);
      }
      fetchLogs();
    } catch (err) {
      console.error('Failed to delete log:', err);
    }
  }, [selectedLog, setSearchParams, fetchLogs]);

  const deleteAllLogs = useCallback(async () => {
    if (!confirm(`Delete ALL ${logs.length} traces? This cannot be undone.`)) return;
    try {
      await fetch('/api/logs', { method: 'DELETE' });
      fetchLogs();
    } catch (err) {
      console.error('Failed to delete logs:', err);
    }
  }, [logs.length, fetchLogs]);

  useEffect(() => {
    if (selectedLog) {
      fetchLogDetail(selectedLog);
    } else {
      fetchLogs();
    }
  }, [selectedLog, fetchLogs, fetchLogDetail]);

  // Auto-refresh every 5s (both list and detail views)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (selectedLog) {
        fetchLogDetail(selectedLog);
      } else {
        fetchLogs();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedLog, fetchLogs, fetchLogDetail]);

  const formatDate = (ts: number) => new Date(ts).toLocaleString();
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const formatMs = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Parse preview to extract session info
  const parsePreview = (preview: string) => {
    const lines = preview.split('\n');
    let session = '', channel = '', model = '';
    for (const line of lines) {
      if (line.startsWith('Session:')) session = line.replace('Session:', '').trim();
      if (line.startsWith('Channel:')) channel = line.replace('Channel:', '').trim();
      if (line.startsWith('Model:')) model = line.replace('Model:', '').trim();
    }
    return { session, channel, model };
  };

  // ── JSONL Detail View ──
  const renderJsonlDetail = (detail: LogDetailJsonl) => {
    const header = detail.lines.find(l => l.type === "header") as TraceHeader | undefined;
    const invocation = detail.lines.find(l => l.type === "invocation") as TraceInvocation | undefined;
    const prompt = detail.lines.find(l => l.type === "prompt") as TracePrompt | undefined;
    const userMessage = detail.lines.find(l => l.type === "user_message") as TraceUserMessage | undefined;
    const memorySearch = detail.lines.find(l => l.type === "memory_search") as TraceMemorySearch | undefined;
    const embeddingResult = detail.lines.find(l => l.type === "embedding_result") as TraceEmbeddingResult | undefined;
    const profileUpdate = detail.lines.find(l => l.type === "profile_update") as TraceProfileUpdate | undefined;
    const footer = detail.lines.find(l => l.type === "footer") as TraceFooter | undefined;
    
    // Get all events (raw + normalized) and filter based on toggle
    // Backward compat: old traces used "raw"/"normalized"/"harness_event" type names
    const rawTypes = new Set(["raw_event", "raw", "harness_event"]);
    const normTypes = new Set(["normalized_event", "normalized"]);
    const allEvents = detail.lines.filter(l => rawTypes.has(l.type) || normTypes.has(l.type)) as (TraceRawEvent | TraceNormalizedEvent)[];
    const filteredEvents = showRaw ? allEvents : allEvents.filter(e => normTypes.has(e.type));

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
                <span className={`ml-auto px-2 py-0.5 rounded text-xs ${footer.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                  {footer.success ? '✓ Success' : '✗ Error'}
                </span>
              )}
            </div>
            <div className="text-neutral-300 font-mono text-sm mt-2">
              {header.session_id}
            </div>
            {footer && (
              <div className="flex items-center gap-4 mt-3 text-xs text-neutral-500">
                <span>Duration: <span className="text-neutral-300">{formatMs(footer.duration_ms)}</span></span>
                <span>Messages: <span className="text-neutral-300">{footer.message_count}</span></span>
                <span>Tool calls: <span className="text-neutral-300">{footer.tool_calls}</span></span>
              </div>
            )}
          </div>
        )}

        {/* Invocation */}
        {invocation && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
            <button
              className="w-full px-4 py-2 flex items-center justify-between text-left bg-neutral-800/50 hover:bg-neutral-800 transition-colors"
              onClick={() => toggleSection('invocation')}
            >
              <span className="text-sm font-medium text-neutral-300">CLI Command</span>
              <span className="text-neutral-500">{expandedSections.has('invocation') ? '−' : '+'}</span>
            </button>
            {expandedSections.has('invocation') && (
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
              {userMessage.content || '(empty)'}
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

        {/* Memory Search */}
        {memorySearch && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
            <button
              className="w-full px-4 py-2 flex items-center justify-between text-left bg-neutral-800/50 hover:bg-neutral-800 transition-colors"
              onClick={() => toggleSection('memory-search')}
            >
              <span className="text-sm font-medium text-neutral-300 flex items-center gap-2">
                🧠 Memory Search
                {memorySearch.skipped ? (
                  <span className="text-neutral-500 font-normal text-xs">skipped — {memorySearch.skipped}</span>
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
              <span className="text-neutral-500">{expandedSections.has('memory-search') ? '−' : '+'}</span>
            </button>
            {expandedSections.has('memory-search') && (
              <div className="p-4 space-y-3">
                <div className="text-xs text-neutral-500">
                  Query: <span className="text-neutral-300 font-mono">"{memorySearch.query}"</span>
                </div>
                {memorySearch.results.length > 0 ? (
                  <div className="space-y-2">
                    {memorySearch.results.map((r, i) => (
                      <div
                        key={r.id}
                        className={`rounded-lg p-3 border ${i < memorySearch.results_injected ? 'bg-emerald-950/20 border-emerald-900/40' : 'bg-neutral-800/30 border-neutral-700/30'}`}
                      >
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${i < memorySearch.results_injected ? 'bg-emerald-900/40 text-emerald-400' : 'bg-neutral-700/50 text-neutral-500'}`}>
                            #{i + 1}
                          </span>
                          <span className="text-xs text-neutral-400 font-mono">{r.day}</span>
                          <span className="text-xs text-neutral-600 font-mono truncate">{r.session_id}</span>
                          <div className="ml-auto flex items-center gap-2">
                            <span className="text-xs text-neutral-600" title="RRF Score">RRF: <span className="text-neutral-400">{r.rrf_score.toFixed(4)}</span></span>
                            <span className="text-xs text-neutral-600" title="Embedding Score">EMB: <span className="text-neutral-400">{r.embedding_score.toFixed(3)}</span></span>
                            <span className="text-xs text-neutral-600" title="BM25 Score">BM25: <span className="text-neutral-400">{r.bm25_score.toFixed(2)}</span></span>
                          </div>
                        </div>
                        {r.context && (
                          <div className="text-xs text-violet-400/70 mb-1 italic">{r.context}</div>
                        )}
                        <div className="text-xs text-neutral-400 font-mono whitespace-pre-wrap break-words">
                          {r.text_preview}{r.text_preview.length >= 200 ? '…' : ''}
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

        {/* Embeddings */}
        {embeddingResult && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
            <button
              className="w-full px-4 py-2 flex items-center justify-between text-left bg-neutral-800/50 hover:bg-neutral-800 transition-colors"
              onClick={() => toggleSection('embedding-result')}
            >
              <span className="text-sm font-medium text-neutral-300 flex items-center gap-2">
                🧬 Embedding Result
                {embeddingResult.skipped ? (
                  <span className="text-neutral-500 font-normal text-xs">skipped — {embeddingResult.skipped}</span>
                ) : (
                  <>
                    <span className="text-neutral-500 font-normal text-xs">
                      {embeddingResult.chunks_created} chunk{embeddingResult.chunks_created === 1 ? '' : 's'}
                    </span>
                    <span className="text-neutral-600 font-normal text-xs">
                      ({formatMs(embeddingResult.duration_ms)})
                    </span>
                  </>
                )}
              </span>
              <span className="text-neutral-500">{expandedSections.has('embedding-result') ? '−' : '+'}</span>
            </button>
            {expandedSections.has('embedding-result') && (
              <div className="p-4 space-y-3">
                <div className="text-xs text-neutral-500">
                  Unembedded buffer: <span className="text-neutral-300 font-mono">{embeddingResult.unembedded_messages} msgs</span>
                  <span className="text-neutral-600"> • </span>
                  <span className="text-neutral-300 font-mono">{embeddingResult.unembedded_chars} chars</span>
                </div>
                {embeddingResult.chunks.length > 0 ? (
                  <div className="space-y-2">
                    {embeddingResult.chunks.map((c, i) => (
                      <div key={`${c.day}-${c.chunk_index}-${i}`} className="rounded-lg p-3 border bg-neutral-800/30 border-neutral-700/30">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <span className="text-xs px-1.5 py-0.5 rounded font-mono bg-neutral-700/50 text-neutral-300">
                            #{c.chunk_index}
                          </span>
                          <span className="text-xs text-neutral-400 font-mono">{c.day}</span>
                          <div className="ml-auto flex items-center gap-2">
                            <span className="text-xs text-neutral-600">msgs: <span className="text-neutral-300">{c.msg_count}</span></span>
                            <span className="text-xs text-neutral-600">chars: <span className="text-neutral-300">{c.char_count}</span></span>
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

        {/* System Prompt */}
        {prompt && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden">
            <button
              className="w-full px-4 py-2 flex items-center justify-between text-left bg-neutral-800/50 hover:bg-neutral-800 transition-colors"
              onClick={() => toggleSection('prompt')}
            >
              <span className="text-sm font-medium text-neutral-300">
                System Prompt <span className="text-neutral-500 font-normal">({prompt.length.toLocaleString()} chars)</span>
              </span>
              <span className="text-neutral-500">{expandedSections.has('prompt') ? '−' : '+'}</span>
            </button>
            {expandedSections.has('prompt') && (
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
                onChange={(e) => setShowRaw(e.target.checked)}
                className="accent-blue-600 cursor-pointer w-3 h-3"
              />
              Show raw
            </label>
          </div>
          <div className="divide-y divide-neutral-800">
            {renderEvents(filteredEvents)}
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
  };

  // ── Render Events (unified - both raw and normalized) ──
  const renderEvents = (events: (TraceRawEvent | TraceNormalizedEvent)[]) => {
    return events.map((e, i) => {
      const key = `event-${i}`;
      const isExpanded = expandedSections.has(key);
      
      const isRaw = e.type === "raw_event" || e.type === ("raw" as any) || e.type === ("harness_event" as any);
      
      // Try to get an event label - don't assume anything about the structure
      let eventLabel = '—';
      let eventStr = '';
      
      try {
        // Try to stringify it - might not be JSON
        if (typeof e.event === 'string') {
          eventStr = e.event;
        } else if (e.event === null || e.event === undefined) {
          eventStr = String(e.event);
        } else {
          eventStr = JSON.stringify(e.event, null, 2);
        }
        
        // Try to extract a type/kind label if it's an object with that property
        if (e.event && typeof e.event === 'object' && !Array.isArray(e.event)) {
          const obj = e.event as Record<string, unknown>;
          if (typeof obj.type === 'string') {
            eventLabel = obj.type;
          } else if (typeof obj.kind === 'string') {
            eventLabel = obj.kind;
          }
        }
      } catch {
        // If stringify fails, just show what we can
        eventStr = String(e.event);
      }
      
      const preview = eventStr.length > 100 ? eventStr.slice(0, 100) + '…' : eventStr;

      return (
        <div 
          key={key} 
          className="px-4 py-2 hover:bg-neutral-800/30"
        >
          <div
            className="flex items-center gap-2 cursor-pointer select-none"
            onClick={() => toggleSection(key)}
          >
            <span className="text-xs text-neutral-600 font-mono w-16">{formatMs(e.ts)}</span>
            <span className={`text-xs px-2 py-0.5 rounded font-mono ${isRaw ? 'bg-neutral-700 text-neutral-400' : 'bg-blue-900/50 text-blue-400'}`}>
              {isRaw ? 'raw' : 'norm'}
            </span>
            <span className="text-xs text-neutral-300 font-mono">
              {eventLabel}
            </span>
            {!isExpanded && (
              <span className="text-xs text-neutral-600 font-mono truncate flex-1">{preview.replace(/\n/g, ' ')}</span>
            )}
            <span className="text-neutral-600 text-xs">{isExpanded ? '▼' : '▶'}</span>
          </div>
          {isExpanded && (
            <pre className="mt-2 text-xs text-neutral-400 font-mono overflow-x-auto whitespace-pre-wrap break-words bg-neutral-800/50 p-2 rounded ml-16 max-h-[400px] overflow-y-auto">
              {eventStr}
            </pre>
          )}
        </div>
      );
    });
  };

  // ── Detail view ──
  if (selectedLog && logDetail) {
    return (
      <div className="flex flex-col pb-8">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
          <button
            className="bg-transparent border-none text-blue-500 text-2xl cursor-pointer px-2 py-1 leading-none hover:text-blue-400"
            onClick={() => { setSearchParams({}); setLogDetail(null); setExpandedSections(new Set()); }}
          >
            ‹
          </button>
          <h2 className="text-lg font-semibold text-white truncate flex-1">{logDetail.filename}</h2>
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
            onClick={() => deleteLog(logDetail.filename)}
            title="Delete trace"
          >
            ✕
          </button>
        </div>

        {logDetail.format === 'jsonl' ? (
          renderJsonlDetail(logDetail)
        ) : (
          <div className="p-4 overflow-x-auto">
            <pre className="bg-neutral-950 border border-neutral-800 rounded-lg p-4 font-mono text-sm text-neutral-300 leading-relaxed whitespace-pre-wrap break-words">
              {logDetail.content}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // Loading state for detail
  if (selectedLog && !logDetail) {
    return <div className="flex flex-col pb-8 text-neutral-400 p-4">Loading trace...</div>;
  }

  // ── List view ──
  if (loading) {
    return <div className="flex flex-col pb-8 text-neutral-400 p-4">Loading traces...</div>;
  }

  return (
    <div className="flex flex-col pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white flex-1">Traces ({logs.length})</h2>
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
            onClick={fetchLogs}
            title="Refresh"
          >
            ↻
          </button>
          {logs.length > 0 && (
            <button
              className="px-3 h-8 flex items-center justify-center rounded-md border bg-neutral-900 border-neutral-800 text-red-400 hover:bg-red-950 hover:border-red-800 text-xs cursor-pointer transition-all"
              onClick={deleteAllLogs}
              title="Delete all traces"
            >
              Delete All
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-2">
        {logs.map((log) => {
          const info = parsePreview(log.preview);
          const isJsonl = log.format === 'jsonl';
          return (
            <div
              key={log.filename}
              className="bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 cursor-pointer transition-all hover:bg-neutral-850 hover:border-neutral-700 active:scale-[0.99] group"
              onClick={() => setSearchParams({ file: log.filename })}
            >
              <div className="flex items-center gap-3 mb-2 text-sm flex-wrap">
                <span className="text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded text-xs">
                  {info.channel || '—'}
                </span>
                <span className="text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded text-xs font-mono">
                  {info.model || '—'}
                </span>
                {isJsonl && (
                  <span className="text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded text-xs">
                    JSONL
                  </span>
                )}
                {log.hasEmbedding && (
                  <span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-xs">
                    Embedding
                  </span>
                )}
                <span className="text-neutral-600 text-xs">
                  {formatSize(log.size)}
                </span>
                <span className="text-neutral-600 ml-auto text-xs">
                  {formatDate(log.timestamp)}
                </span>
                <button
                  className="w-6 h-6 flex items-center justify-center rounded border bg-neutral-900 border-neutral-700 text-red-400 hover:bg-red-950 hover:border-red-800 text-xs cursor-pointer transition-all opacity-0 group-hover:opacity-100"
                  onClick={(e) => { e.stopPropagation(); deleteLog(log.filename); }}
                  title="Delete trace"
                >
                  ✕
                </button>
              </div>
              <div className="text-neutral-300 text-sm leading-relaxed">
                {log.alias || info.session || log.filename}
              </div>
              {log.alias && info.session && (
                <div className="text-neutral-600 text-xs font-mono mt-1 truncate">
                  {info.session}
                </div>
              )}
            </div>
          );
        })}
        {logs.length === 0 && (
          <div className="text-center text-neutral-500 py-12">
            No traces yet. Send a message to start logging.
          </div>
        )}
      </div>
    </div>
  );
}

export default Traces;
