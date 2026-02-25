import { useState, useEffect, useCallback, useRef } from 'react';

// ══════════════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════════════

interface Profile {
  basics?: {
    name?: string;
    email?: string;
    phone?: string;
    timezone?: string;
    location?: string;
    faith?: string;
  };
  people?: Array<{
    name: string;
    relation: string;
    email?: string;
    phone?: string;
    notes?: string[];
  }>;
  interests?: Array<{
    topic: string;
    level?: string;
    notes?: string[];
  }>;
  preferences?: {
    communication?: string[];
    code?: string[];
    design?: string[];
  };
  work?: {
    employer?: string;
    role?: string;
    side_projects?: string[];
  };
  notes?: Array<{
    key: string;
    value: string;
  }>;
}

interface EmbeddingsStats {
  totalChunks: number;
  totalSessions: number;
  totalDays: number;
  oldestDay: string;
  newestDay: string;
  sessions: Array<{
    session_id: string;
    alias: string | null;
    count: number;
    first_day: string;
    last_day: string;
  }>;
}

interface SearchResult {
  id: number;
  session_id: string;
  day: string;
  chunk_index: number;
  text: string;
  context: string | null;
  msg_count: number;
  rrfScore: number;
  embeddingScore: number;
  bm25Score: number;
}

interface SearchResponse {
  query: string;
  mode: string;
  duration_ms: number;
  results: SearchResult[];
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

function Memory() {
  const [tab, setTab] = useState<'profile' | 'embeddings'>('profile');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white">Memory</h2>
        <div className="flex gap-1 bg-neutral-900 rounded-lg p-0.5">
          <button
            onClick={() => setTab('profile')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
              tab === 'profile'
                ? 'bg-blue-950 text-blue-400'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
            }`}
          >
            👤 Profile
          </button>
          <button
            onClick={() => setTab('embeddings')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
              tab === 'embeddings'
                ? 'bg-blue-950 text-blue-400'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
            }`}
          >
            🧠 Embeddings
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'profile' ? <ProfileTab /> : <EmbeddingsTab />}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PROFILE TAB
// ══════════════════════════════════════════════════════════════════════════════

function ProfileTab() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/memory/profile')
      .then(res => res.json())
      .then(data => {
        setProfile(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="p-4 text-neutral-400">Loading profile...</div>;
  if (error) return <div className="p-4 text-red-400">Error: {error}</div>;
  if (!profile) return <div className="p-4 text-neutral-500">No profile found.</div>;

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      {/* Basics */}
      {profile.basics && (
        <ProfileSection title="Basics" emoji="📋">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {profile.basics.name && <ProfileField label="Name" value={profile.basics.name} />}
            {profile.basics.email && <ProfileField label="Email" value={profile.basics.email} />}
            {profile.basics.phone && <ProfileField label="Phone" value={profile.basics.phone} />}
            {profile.basics.location && <ProfileField label="Location" value={profile.basics.location} />}
            {profile.basics.timezone && <ProfileField label="Timezone" value={profile.basics.timezone} />}
            {profile.basics.faith && <ProfileField label="Faith" value={profile.basics.faith} />}
          </div>
        </ProfileSection>
      )}

      {/* People */}
      {profile.people && profile.people.length > 0 && (
        <ProfileSection title={`People (${profile.people.length})`} emoji="👥">
          <div className="space-y-2">
            {profile.people.map((p, i) => (
              <div key={i} className="bg-neutral-800/50 rounded-lg p-3">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-semibold text-neutral-100">{p.name}</span>
                  <span className="text-xs text-blue-400 bg-blue-950/50 px-2 py-0.5 rounded-full">{p.relation}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-400">
                  {p.phone && <span>📞 {p.phone}</span>}
                  {p.email && <span>✉️ {p.email}</span>}
                </div>
                {p.notes && p.notes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.notes.map((note, j) => (
                      <span key={j} className="text-xs text-neutral-300 bg-neutral-700/60 px-2 py-0.5 rounded">
                        {note}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </ProfileSection>
      )}

      {/* Interests */}
      {profile.interests && profile.interests.length > 0 && (
        <ProfileSection title="Interests" emoji="⭐">
          <div className="space-y-2">
            {profile.interests.map((interest, i) => (
              <div key={i} className="bg-neutral-800/50 rounded-lg p-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold text-neutral-100">{interest.topic}</span>
                  {interest.level && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      interest.level === 'obsessed' ? 'bg-red-950/50 text-red-400' :
                      interest.level === 'active' ? 'bg-green-950/50 text-green-400' :
                      interest.level === 'casual' ? 'bg-amber-950/50 text-amber-400' :
                      'bg-purple-950/50 text-purple-400'
                    }`}>
                      {interest.level}
                    </span>
                  )}
                </div>
                {interest.notes && interest.notes.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {interest.notes.map((note, j) => (
                      <li key={j} className="text-xs text-neutral-400 pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-neutral-600">
                        {note}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </ProfileSection>
      )}

      {/* Preferences */}
      {profile.preferences && (
        <ProfileSection title="Preferences" emoji="🎯">
          <div className="space-y-3">
            {profile.preferences.communication && profile.preferences.communication.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1.5">Communication</h4>
                <div className="flex flex-wrap gap-1.5">
                  {profile.preferences.communication.map((p, i) => (
                    <span key={i} className="text-xs text-neutral-300 bg-neutral-700/60 px-2 py-1 rounded">{p}</span>
                  ))}
                </div>
              </div>
            )}
            {profile.preferences.code && profile.preferences.code.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1.5">Code</h4>
                <div className="flex flex-wrap gap-1.5">
                  {profile.preferences.code.map((p, i) => (
                    <span key={i} className="text-xs text-neutral-300 bg-neutral-700/60 px-2 py-1 rounded">{p}</span>
                  ))}
                </div>
              </div>
            )}
            {profile.preferences.design && profile.preferences.design.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1.5">Design</h4>
                <div className="flex flex-wrap gap-1.5">
                  {profile.preferences.design.map((p, i) => (
                    <span key={i} className="text-xs text-neutral-300 bg-neutral-700/60 px-2 py-1 rounded">{p}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ProfileSection>
      )}

      {/* Work */}
      {profile.work && (
        <ProfileSection title="Work" emoji="💼">
          <div className="space-y-2">
            {(profile.work.role || profile.work.employer) && (
              <div className="text-sm text-neutral-200">
                {profile.work.role && <span className="font-medium">{profile.work.role}</span>}
                {profile.work.role && profile.work.employer && <span className="text-neutral-500"> @ </span>}
                {profile.work.employer && <span>{profile.work.employer}</span>}
              </div>
            )}
            {profile.work.side_projects && profile.work.side_projects.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {profile.work.side_projects.map((p, i) => (
                  <span key={i} className="text-xs text-amber-300 bg-amber-950/40 px-2 py-0.5 rounded">
                    {p}
                  </span>
                ))}
              </div>
            )}
          </div>
        </ProfileSection>
      )}

      {/* Notes */}
      {profile.notes && profile.notes.length > 0 && (
        <ProfileSection title="Notes" emoji="📝">
          <div className="space-y-1.5">
            {profile.notes.map((note, i) => (
              <div key={i} className="flex gap-2 text-sm">
                <span className="text-neutral-500 font-mono text-xs min-w-[140px] shrink-0 pt-0.5">{note.key}</span>
                <span className="text-neutral-300">{note.value}</span>
              </div>
            ))}
          </div>
        </ProfileSection>
      )}
    </div>
  );
}

function ProfileSection({ title, emoji, children }: { title: string; emoji: string; children: React.ReactNode }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-neutral-200 mb-3 flex items-center gap-2">
        <span>{emoji}</span>
        {title}
      </h3>
      {children}
    </div>
  );
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">{label}</span>
      <div className="text-sm text-neutral-200 mt-0.5">{value}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// EMBEDDINGS TAB
// ══════════════════════════════════════════════════════════════════════════════

function EmbeddingsTab() {
  const [stats, setStats] = useState<EmbeddingsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'hybrid' | 'embedding' | 'bm25'>('hybrid');
  const [searchLimit, setSearchLimit] = useState(10);
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/memory/embeddings/stats')
      .then(res => res.json())
      .then(data => {
        setStats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/memory/embeddings/search?q=${encodeURIComponent(searchQuery)}&mode=${searchMode}&limit=${searchLimit}`);
      const data = await res.json();
      setSearchResults(data);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, searchMode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  if (loading) return <div className="p-4 text-neutral-400">Loading embeddings data...</div>;

  return (
    <div className="p-4 space-y-4 max-w-4xl">
      {/* Stats */}
      {stats && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-neutral-200 mb-3 flex items-center gap-2">
            <span>📊</span> Overview
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Chunks" value={stats.totalChunks.toString()} />
            <StatCard label="Sessions" value={stats.totalSessions.toString()} />
            <StatCard label="Date Range" value={`${stats.oldestDay || '—'} → ${stats.newestDay || '—'}`} small />
            <StatCard label="Days" value={stats.totalDays.toString()} />
          </div>

          {/* Per-session breakdown */}
          {stats.sessions.length > 0 && (
            <div className="mt-4 pt-3 border-t border-neutral-800">
              <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">By Session</h4>
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
        <div className="flex gap-2">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-4 py-2.5 text-sm text-neutral-200 focus:outline-none focus:border-blue-600 transition-colors"
          />
          <select
            value={searchMode}
            onChange={(e) => setSearchMode(e.target.value as any)}
            className="bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-xs text-neutral-300 focus:outline-none focus:border-blue-600"
          >
            <option value="hybrid">Hybrid</option>
            <option value="embedding">Embedding</option>
            <option value="bm25">BM25</option>
          </select>
          <div className="flex items-center gap-1.5 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5">
            <label className="text-[10px] text-neutral-500 uppercase tracking-wider whitespace-nowrap">Limit</label>
            <input
              type="number"
              min={1}
              max={50}
              value={searchLimit}
              onChange={(e) => setSearchLimit(Math.max(1, Math.min(50, parseInt(e.target.value) || 10)))}
              className="w-10 bg-transparent text-sm text-neutral-200 text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            {searching ? '...' : 'Search'}
          </button>
        </div>

        {/* Results */}
        {searchResults && (
          <div className="mt-4 pt-3 border-t border-neutral-800">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-neutral-500">
                {searchResults.results.length} result{searchResults.results.length !== 1 ? 's' : ''} for "{searchResults.query}"
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
                    <div className="px-3 py-2.5 flex items-start gap-2">
                      <span className="text-xs text-neutral-600 font-mono shrink-0 pt-0.5">#{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-xs text-neutral-300 font-medium">{result.session_id}</span>
                          <span className="text-[10px] text-neutral-500">{result.day}</span>
                          <span className="text-[10px] text-neutral-600">{result.msg_count} msgs</span>
                        </div>
                        {result.context && (
                          <p className="text-xs text-neutral-400 mt-1">{result.context}</p>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0 text-[10px] font-mono">
                        {result.rrfScore > 0 && (
                          <span className="text-emerald-400" title="RRF Score">
                            RRF {result.rrfScore.toFixed(4)}
                          </span>
                        )}
                        {result.embeddingScore > 0 && (
                          <span className="text-blue-400" title="Embedding Score">
                            EMB {result.embeddingScore.toFixed(3)}
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
      <div className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">{label}</div>
      <div className={`text-neutral-200 mt-0.5 ${small ? 'text-xs font-mono' : 'text-lg font-bold'}`}>{value}</div>
    </div>
  );
}

export default Memory;
