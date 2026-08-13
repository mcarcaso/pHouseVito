import { useCallback, useRef, useState } from "react";
import { useEmbeddingStats, useMemorySearch } from "../../hooks/useMemory";

export default function EmbeddingsTab() {
  const statsQuery = useEmbeddingStats();
  const search = useMemorySearch();
  const stats = statsQuery.data ?? null;
  const loading = statsQuery.isPending;
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"hybrid" | "embedding" | "bm25">("hybrid");
  const [searchLimit, setSearchLimit] = useState(10);
  const searchResults = search.data ?? null;
  const searching = search.isPending;
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    await search
      .mutateAsync({ query: searchQuery, mode: searchMode, limit: searchLimit })
      .catch((error: unknown) => console.error("Search failed:", error));
  }, [searchQuery, searchMode, searchLimit, search]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  if (loading) return <div className="p-4 text-neutral-400">Loading embeddings data...</div>;

  return (
    <div className="p-4 space-y-4">
      {/* Stats */}
      {stats && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-neutral-200 mb-3 flex items-center gap-2">
            <span>📊</span> Overview
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Chunks" value={stats.totalChunks.toString()} />
            <StatCard label="Sessions" value={stats.totalSessions.toString()} />
            <StatCard
              label="Date Range"
              value={`${stats.oldestDay || "—"} → ${stats.newestDay || "—"}`}
              small
            />
            <StatCard label="Days" value={stats.totalDays.toString()} />
          </div>

          {/* Per-session breakdown */}
          {stats.sessions.length > 0 && (
            <div className="mt-4 pt-3 border-t border-neutral-800">
              <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
                By Session
              </h4>
              <div className="space-y-1.5">
                {stats.sessions.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <div
                      className="h-2 rounded-full bg-blue-500 shrink-0"
                      style={{ width: `${Math.max(8, (s.count / stats.totalChunks) * 200)}px` }}
                    />
                    <span className="text-neutral-400 truncate flex-1 min-w-0" title={s.session_id}>
                      {s.alias || s.session_id}
                    </span>
                    <span className="text-neutral-500 font-mono shrink-0">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-neutral-200 mb-3 flex items-center gap-2">
          <span>🔍</span> Search Embeddings
        </h3>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm text-neutral-200 focus:outline-none focus:border-blue-600 transition-colors"
          />
          <div className="flex gap-2">
            <select
              value={searchMode}
              onChange={(e) => setSearchMode(e.target.value as "hybrid" | "embedding" | "bm25")}
              className="flex-1 sm:flex-none bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-xs text-neutral-300 focus:outline-none focus:border-blue-600"
            >
              <option value="hybrid">Hybrid</option>
              <option value="embedding">Embedding</option>
              <option value="bm25">BM25</option>
            </select>
            <div className="flex items-center gap-1.5 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5">
              <label className="text-[10px] text-neutral-500 uppercase tracking-wider whitespace-nowrap">
                Limit
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={searchLimit}
                onChange={(e) =>
                  setSearchLimit(Math.max(1, Math.min(50, parseInt(e.target.value) || 10)))
                }
                className="w-10 bg-transparent text-sm text-neutral-200 text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={searching || !searchQuery.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors whitespace-nowrap"
            >
              {searching ? "..." : "Search"}
            </button>
          </div>
        </div>

        {/* Results */}
        {searchResults && (
          <div className="mt-4 pt-3 border-t border-neutral-800">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-neutral-500">
                {searchResults.results.length} result{searchResults.results.length !== 1 ? "s" : ""}{" "}
                for "{searchResults.query}"
              </span>
              <span className="text-xs text-neutral-600 font-mono">
                {searchResults.duration_ms}ms • {searchResults.mode}
              </span>
            </div>

            {searchResults.results.length === 0 ? (
              <div className="text-center text-neutral-500 py-8 text-sm">No results found</div>
            ) : (
              <div className="space-y-2">
                {searchResults.results.map((result, i) => (
                  <div
                    key={result.id}
                    className="bg-neutral-800/50 border border-neutral-800 rounded-lg"
                  >
                    {/* Result header */}
                    <div className="px-3 py-2.5">
                      <div className="flex items-start gap-2">
                        <span className="text-xs text-neutral-600 font-mono shrink-0 pt-0.5">
                          #{i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-xs text-neutral-300 font-medium truncate">
                              {result.session_id}
                            </span>
                            <span className="text-[10px] text-neutral-500">{result.day}</span>
                            <span className="text-[10px] text-neutral-600">
                              {result.msg_count} msgs
                            </span>
                            {result.daysAgo > 0 && (
                              <span className="text-[10px] text-neutral-600">
                                ({result.daysAgo}d ago)
                              </span>
                            )}
                          </div>
                          {result.context && (
                            <p className="text-xs text-neutral-400 mt-1">{result.context}</p>
                          )}
                        </div>
                      </div>
                      {/* Scores — wrap on mobile */}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] font-mono">
                        {result.rrfScore > 0 && (
                          <span className="text-emerald-400" title="RRF Score">
                            RRF {result.rrfScore.toFixed(4)}
                          </span>
                        )}
                        {result.embeddingScore > 0 && (
                          <span className="text-blue-400" title="Embedding Score (with recency)">
                            EMB {result.embeddingScore.toFixed(3)}
                          </span>
                        )}
                        {result.rawEmbeddingScore > 0 && result.recencyFactor < 1 && (
                          <span
                            className="text-purple-400"
                            title={`Raw: ${result.rawEmbeddingScore.toFixed(3)} × ${result.recencyFactor.toFixed(2)} decay`}
                          >
                            ×{result.recencyFactor.toFixed(2)} decay
                          </span>
                        )}
                        {result.bm25Score > 0 && (
                          <span className="text-amber-400" title="BM25 Score">
                            BM25 {result.bm25Score.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Chunk text — always visible */}
                    <div className="px-3 pb-3 pt-0 border-t border-neutral-800">
                      <pre className="text-xs text-neutral-300 whitespace-pre-wrap font-mono leading-relaxed mt-2 max-h-[400px] overflow-y-auto">
                        {result.text}
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="bg-neutral-800/50 rounded-lg p-3">
      <div className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">
        {label}
      </div>
      <div
        className={`text-neutral-200 mt-0.5 ${small ? "text-xs font-mono" : "text-lg font-bold"}`}
      >
        {value}
      </div>
    </div>
  );
}
