import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import ChatView, { parseDbMessage, type ParsedMessage, type FilterState } from './ChatView';
import FilterButton from './FilterButton';

interface Session {
  id: string;
  channel: string;
  channel_target: string;
  created_at: number;
  last_active_at: number;
  config: string;
}

interface SessionConfig {
  streamMode?: string;
  harness?: string;
  model?: {
    provider: string;
    name: string;
  };
  'pi-coding-agent'?: {
    model?: { provider: string; name: string };
  };
}

interface Message {
  id: number;
  session_id: string;
  type: string;
  content: string;
  timestamp: number;
  compacted: boolean;
}

const MESSAGES_PER_PAGE = 50;

function Sessions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const selectedSession = searchParams.get('id');

  const [sessions, setSessions] = useState<Session[]>([]);
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const autoRefreshRef = useRef(autoRefresh);
  autoRefreshRef.current = autoRefresh;

  const [filterState, setFilterState] = useState<FilterState>({ showThoughts: true, showTools: true });

  const fetchSessionsSilent = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      setSessions(data);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (selectedSession) {
        fetchMessages(selectedSession, false, filterState);
      } else {
        fetchSessionsSilent();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedSession, fetchSessionsSilent, filterState]);

  useEffect(() => {
    if (selectedSession) {
      fetchMessages(selectedSession, false, filterState);
    }
  }, [selectedSession, filterState]);

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      setSessions(data);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (sessionId: string, loadMore = false, filter?: FilterState) => {
    try {
      if (loadMore) {
        setLoadingMore(true);
      }
      
      const beforeId = loadMore && allMessages.length > 0 ? allMessages[0].id : undefined;
      
      const params = new URLSearchParams();
      params.set('limit', String(MESSAGES_PER_PAGE));
      if (beforeId) {
        params.set('before', String(beforeId));
      }
      if (filter) {
        if (!filter.showThoughts) params.set('hideThoughts', 'true');
        if (!filter.showTools) params.set('hideTools', 'true');
      }
      
      const res = await fetch(`/api/sessions/${sessionId}/messages?${params}`);
      const data = await res.json();
      
      if (loadMore) {
        setAllMessages(prev => [...data.messages, ...prev]);
      } else {
        setAllMessages(data.messages);
      }
      
      setTotalMessages(data.total);
      
      if (loadMore) {
        setHasMoreMessages(data.messages.length >= MESSAGES_PER_PAGE);
      } else {
        setHasMoreMessages(data.messages.length < data.total);
      }
      
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    } finally {
      setLoadingMore(false);
    }
  };
  
  const loadEarlierMessages = () => {
    if (selectedSession && !loadingMore) {
      fetchMessages(selectedSession, true, filterState);
    }
  };

  const formatRelativeTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return date.toLocaleTimeString();
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  // Load session config to check for overrides (for indicator badge)
  const [sessionConfig, setSessionConfig] = useState<SessionConfig>({});
  
  useEffect(() => {
    if (selectedSession) {
      fetch(`/api/sessions/${selectedSession}/config`)
        .then(r => r.json())
        .then(setSessionConfig)
        .catch(err => console.error('Failed to load session config:', err));
    }
  }, [selectedSession]);
  
  // Check if session has any overrides configured
  const hasOverrides = sessionConfig.streamMode || sessionConfig.harness || sessionConfig.model || sessionConfig['pi-coding-agent'];

  const parsedMessages: ParsedMessage[] = allMessages.map((msg) =>
    parseDbMessage({ type: msg.type, content: msg.content, timestamp: msg.timestamp })
  );

  const hasScrolledRef = useRef(false);
  
  useEffect(() => {
    if (allMessages.length > 0 && !hasScrolledRef.current) {
      hasScrolledRef.current = true;
      setTimeout(() => {
        window.scrollTo(0, document.body.scrollHeight);
      }, 100);
    }
  }, [allMessages]);

  useEffect(() => {
    hasScrolledRef.current = false;
  }, [selectedSession]);

  if (loading) {
    return <div className="flex flex-col pb-8 text-neutral-400 p-4">Loading sessions...</div>;
  }

  // Detail view
  if (selectedSession) {
    return (
      <div className="flex flex-col pb-8">
        {/* Sticky header container - top-[52px] on mobile for the fixed header, top-0 on desktop */}
        <div className="sticky top-[52px] md:top-0 z-20 bg-neutral-950/95 backdrop-blur">
          {/* Toolbar */}
          <div className="flex items-center px-4 py-3 gap-3 border-b border-neutral-800">
            <button
              className="bg-transparent border-none text-blue-500 text-2xl cursor-pointer px-2 py-1 leading-none hover:text-blue-400"
              onClick={() => setSearchParams({})}
            >
              ‹
            </button>
            <span className="text-sm text-neutral-500 flex-1">{totalMessages} messages</span>
            <div className="flex items-center gap-2">
              <FilterButton
                active={!filterState.showThoughts}
                onClick={() => setFilterState(prev => ({ ...prev, showThoughts: !prev.showThoughts }))}
                title={filterState.showThoughts ? 'Hide thoughts' : 'Show thoughts'}
                emoji="💭"
              />
              <FilterButton
                active={!filterState.showTools}
                onClick={() => setFilterState(prev => ({ ...prev, showTools: !prev.showTools }))}
                title={filterState.showTools ? 'Hide tools' : 'Show tools'}
                emoji="🔧"
              />
              <button
                className="w-9 h-9 flex items-center justify-center rounded-md border bg-neutral-900 border-neutral-800 text-neutral-500 hover:bg-neutral-800 hover:border-neutral-700 hover:text-neutral-300 text-base cursor-pointer transition-all active:rotate-180"
                onClick={() => fetchMessages(selectedSession, false, filterState)}
                title="Refresh"
              >
                ↻
              </button>
              <button
                className={`relative w-9 h-9 flex items-center justify-center rounded-md border text-base cursor-pointer transition-all ${
                  hasOverrides
                    ? 'bg-blue-950 border-blue-600 text-blue-400'
                    : 'bg-neutral-900 border-neutral-800 text-neutral-500 hover:bg-neutral-800 hover:border-neutral-700 hover:text-neutral-300'
                }`}
                onClick={() => navigate(`/sessions/${selectedSession}/settings`)}
                title="Session Settings"
              >
                ⚙️
                {hasOverrides && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-blue-500 rounded-full" />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 pt-3">
          {allMessages.length > 0 ? (
            <ChatView
              messages={parsedMessages}
              autoScroll={false}
              showFilters={true}
              reversed={true}
              hasMoreOnServer={hasMoreMessages}
              loadingMore={loadingMore}
              onLoadMore={loadEarlierMessages}
              totalMessages={totalMessages}
              static={true}
              filterState={filterState}
              onFilterStateChange={setFilterState}
              serverSideFiltering={true}
            />
          ) : (
            <div className="text-center text-neutral-500 py-12">No messages in this session</div>
          )}
        </div>
      </div>
    );
  }

  // Session list view
  return (
    <div className="flex flex-col pb-8">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white">Sessions ({sessions.length})</h2>
        <div className="flex items-center gap-2 ml-auto">
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
            className="w-8 h-8 flex items-center justify-center rounded-md border bg-neutral-900 border-neutral-800 text-neutral-500 hover:bg-neutral-800 hover:border-neutral-700 hover:text-neutral-300 text-lg cursor-pointer transition-all active:rotate-180"
            onClick={fetchSessionsSilent}
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-2">
        {sessions.map((session) => {
          const config: SessionConfig = JSON.parse(session.config || '{}');
          const hasConfig = config.streamMode || config.harness || config.model || config['pi-coding-agent'];
          
          return (
            <div
              key={session.id}
              className="bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 cursor-pointer transition-all hover:bg-neutral-850 hover:border-neutral-700 active:scale-[0.99]"
              onClick={() => setSearchParams({ id: session.id })}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="font-semibold text-blue-500 capitalize text-sm">{session.channel}</span>
                <div className="flex items-center gap-2">
                  <button
                    className={`relative w-7 h-7 flex items-center justify-center rounded-md text-sm transition-all ${
                      hasConfig
                        ? 'text-blue-400 hover:bg-blue-950'
                        : 'text-neutral-600 hover:text-neutral-400 hover:bg-neutral-800'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/sessions/${session.id}/settings`);
                    }}
                    title="Session Settings"
                  >
                    ⚙️
                    {hasConfig && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-500 rounded-full" />
                    )}
                  </button>
                  <span className="text-xs text-neutral-600">{formatRelativeTime(session.last_active_at)}</span>
                </div>
              </div>
              <div className="text-xs text-neutral-500 font-mono truncate">{session.id}</div>
            </div>
          );
        })}
        {sessions.length === 0 && (
          <div className="text-center text-neutral-500 py-12">No sessions yet</div>
        )}
      </div>
    </div>
  );
}

export default Sessions;
