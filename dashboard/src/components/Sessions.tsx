import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import ChatView, { parseDbMessage, type ParsedMessage } from './ChatView';
import './Sessions.css';

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
  model?: {
    provider: string;
    name: string;
  };
}

interface Message {
  id: number;
  session_id: string;
  role: string;
  content: string;
  timestamp: number;
  compacted: boolean;
}

interface ModelOption {
  id: string;
}

type SortField = 'id' | 'role' | 'timestamp' | 'compacted';
type SortDirection = 'asc' | 'desc';
type ViewMode = 'table' | 'chat';

function Sessions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedSession = searchParams.get('id');

  const [sessions, setSessions] = useState<Session[]>([]);
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [displayedMessages, setDisplayedMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageOffset, setMessageOffset] = useState(0);
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const MESSAGE_PAGE_SIZE = 20;
  const [autoRefresh, setAutoRefresh] = useState(true);
  const autoRefreshRef = useRef(autoRefresh);
  autoRefreshRef.current = autoRefresh;

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
        fetchMessages(selectedSession);
      } else {
        fetchSessionsSilent();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedSession, fetchSessionsSilent]);

  useEffect(() => {
    if (selectedSession) {
      fetchMessages(selectedSession);
    }
  }, [selectedSession]);

  useEffect(() => {
    const sorted = [...allMessages].sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];
      if (sortField === 'compacted') {
        aVal = a.compacted ? 1 : 0;
        bVal = b.compacted ? 1 : 0;
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    setDisplayedMessages(sorted.slice(0, messageOffset + MESSAGE_PAGE_SIZE));
  }, [allMessages, sortField, sortDirection, messageOffset]);

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

  const fetchMessages = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/messages`);
      const data = await res.json();
      setAllMessages(data);
      setMessageOffset(0);
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    setMessageOffset(0);
  };

  const loadMoreMessages = () => {
    setMessageOffset(messageOffset + MESSAGE_PAGE_SIZE);
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
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

  const parseContent = (content: string) => {
    try {
      const parsed = JSON.parse(content);
      if (parsed.text) return parsed.text;
      if (typeof parsed === 'string') return parsed;
      return JSON.stringify(parsed, null, 2);
    } catch {
      return content;
    }
  };

  const truncateContent = (content: string, maxLength: number = 100) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  };

  const toggleMessageExpanded = (messageId: number) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return '⇅';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  // Session model override state
  const [sessionConfig, setSessionConfig] = useState<SessionConfig>({});
  const [providers, setProviders] = useState<string[]>([]);
  const [sessionModels, setSessionModels] = useState<ModelOption[]>([]);
  const [loadingSessionModels, setLoadingSessionModels] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [showModelOverride, setShowModelOverride] = useState(false);

  // Load providers once
  useEffect(() => {
    fetch('/api/models/providers')
      .then(r => r.json())
      .then(data => setProviders(data))
      .catch(err => console.error('Failed to load providers:', err));
  }, []);

  // Load session config when session changes
  useEffect(() => {
    if (selectedSession) {
      fetch(`/api/sessions/${selectedSession}/config`)
        .then(r => r.json())
        .then(data => {
          setSessionConfig(data);
          setShowModelOverride(!!data.model?.provider);
          if (data.model?.provider) {
            loadSessionModels(data.model.provider);
          }
        })
        .catch(err => console.error('Failed to load session config:', err));
    }
  }, [selectedSession]);

  const loadSessionModels = async (provider: string) => {
    setLoadingSessionModels(true);
    try {
      const res = await fetch(`/api/models/${provider}`);
      const data = await res.json();
      setSessionModels(data);
    } catch (err) {
      setSessionModels([]);
    }
    setLoadingSessionModels(false);
  };

  const saveSessionConfig = async (config: SessionConfig) => {
    if (!selectedSession) return;
    setSavingConfig(true);
    try {
      const res = await fetch(`/api/sessions/${selectedSession}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const updated = await res.json();
      setSessionConfig(updated);
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save session config:', err);
    }
    setSavingConfig(false);
  };

  const handleSessionProviderChange = (provider: string) => {
    const newConfig = { ...sessionConfig, model: { provider, name: '' } };
    setSessionConfig(newConfig);
    loadSessionModels(provider);
  };

  const handleSessionModelChange = (name: string) => {
    const newConfig = { ...sessionConfig, model: { ...sessionConfig.model!, name } };
    setSessionConfig(newConfig);
    saveSessionConfig(newConfig);
  };

  const clearModelOverride = () => {
    const { model, ...rest } = sessionConfig;
    const newConfig = rest;
    setSessionConfig(newConfig);
    setShowModelOverride(false);
    saveSessionConfig(newConfig);
  };

  const popularProviders = ['anthropic', 'openai', 'google', 'xai', 'mistral', 'openrouter'];
  const sortedProviders = [
    ...popularProviders.filter(p => providers.includes(p)),
    ...providers.filter(p => !popularProviders.includes(p)).sort(),
  ];

  // Parse messages for ChatView
  const parsedMessages: ParsedMessage[] = allMessages.map((msg) =>
    parseDbMessage({ role: msg.role, content: msg.content, timestamp: msg.timestamp })
  );

  if (loading) {
    return <div className="sessions-page">Loading sessions...</div>;
  }

  // Detail view
  if (selectedSession) {
    return (
      <div className="sessions-page">
        <div className="page-header">
          <button className="back-link" onClick={() => setSearchParams({})}>‹ Sessions</button>
          <h2>Messages ({allMessages.length})</h2>
          <div className="refresh-controls">
            <div className="view-mode-toggle">
              <button
                className={`view-mode-btn ${viewMode === 'chat' ? 'active' : ''}`}
                onClick={() => setViewMode('chat')}
                title="Chat View"
              >
                💬
              </button>
              <button
                className={`view-mode-btn ${viewMode === 'table' ? 'active' : ''}`}
                onClick={() => setViewMode('table')}
                title="Table View"
              >
                📋
              </button>
            </div>
            <label className="auto-refresh-toggle">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto
            </label>
            <button className="refresh-btn" onClick={() => fetchMessages(selectedSession)} title="Refresh">
              ↻
            </button>
          </div>
        </div>

        <div className="session-detail-content">
          <div className="session-config-bar">
            <span className="session-id-label">{selectedSession}</span>
            <div className="session-model-section">
              {!showModelOverride ? (
                <button
                  className="model-override-btn"
                  onClick={() => setShowModelOverride(true)}
                >
                  🤖 Set Model Override
                </button>
              ) : (
                <div className="model-override-controls">
                  <select
                    className="session-model-select"
                    value={sessionConfig.model?.provider || ''}
                    onChange={(e) => handleSessionProviderChange(e.target.value)}
                  >
                    <option value="">Provider...</option>
                    {sortedProviders.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  {loadingSessionModels ? (
                    <span className="loading-hint">Loading...</span>
                  ) : (
                    <select
                      className="session-model-select"
                      value={sessionConfig.model?.name || ''}
                      onChange={(e) => handleSessionModelChange(e.target.value)}
                    >
                      <option value="">Model...</option>
                      {sessionModels.map(m => (
                        <option key={m.id} value={m.id}>{m.id}</option>
                      ))}
                    </select>
                  )}
                  <button
                    className="clear-override-btn"
                    onClick={clearModelOverride}
                    title="Remove model override (use global default)"
                  >
                    ✕
                  </button>
                  {configSaved && <span className="config-saved-hint">Saved ✓</span>}
                </div>
              )}
              {sessionConfig.model?.provider && sessionConfig.model?.name && (
                <span className="session-model-badge">
                  🤖 {sessionConfig.model.provider}/{sessionConfig.model.name}
                </span>
              )}
            </div>
          </div>

          {allMessages.length > 0 ? (
            viewMode === 'chat' ? (
              <div className="session-chat-view">
                <ChatView
                  messages={parsedMessages}
                  autoScroll={false}
                  showFilters={true}
                  reversed={true}
                />
              </div>
            ) : (
              <>
                <div className="messages-table-actions">
                  <button
                    className="expand-all-btn"
                    onClick={() => {
                      if (expandedMessages.size > 0) {
                        setExpandedMessages(new Set());
                      } else {
                        setExpandedMessages(new Set(displayedMessages.map((m) => m.id)));
                      }
                    }}
                  >
                    {expandedMessages.size > 0 ? 'Collapse All' : 'Expand All'}
                  </button>
                </div>
                <div className="messages-table-container">
                  <table className="messages-table">
                    <thead>
                      <tr>
                        <th onClick={() => handleSort('id')} className="sortable">
                          ID {getSortIcon('id')}
                        </th>
                        <th onClick={() => handleSort('role')} className="sortable">
                          Role {getSortIcon('role')}
                        </th>
                        <th onClick={() => handleSort('timestamp')} className="sortable">
                          Time {getSortIcon('timestamp')}
                        </th>
                        <th>Content</th>
                        <th onClick={() => handleSort('compacted')} className="sortable">
                          C {getSortIcon('compacted')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedMessages.map((msg) => {
                        const content = parseContent(msg.content);
                        const isExpanded = expandedMessages.has(msg.id);
                        return (
                          <tr key={msg.id} className={`message-row ${msg.role}`}>
                            <td className="message-id">{msg.id}</td>
                            <td className="message-role">
                              <span className={`role-badge ${msg.role}`}>{msg.role}</span>
                            </td>
                            <td className="message-timestamp">
                              {formatTimestamp(msg.timestamp)}
                            </td>
                            <td className="message-content-cell">
                              <div
                                className={`content-preview expandable ${isExpanded ? 'expanded' : ''}`}
                                onClick={() => toggleMessageExpanded(msg.id)}
                              >
                                {isExpanded ? content : truncateContent(content, 150)}
                              </div>
                            </td>
                            <td className="message-compacted">
                              {msg.compacted ? (
                                <span className="compacted-badge">✓</span>
                              ) : (
                                <span className="not-compacted">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {displayedMessages.length < allMessages.length && (
                  <div className="load-more-container">
                    <button className="load-more-btn" onClick={loadMoreMessages}>
                      Load More ({displayedMessages.length} of {allMessages.length})
                    </button>
                  </div>
                )}
              </>
            )
          ) : (
            <div className="empty-state">No messages in this session</div>
          )}
        </div>
      </div>
    );
  }

  // Session list view
  return (
    <div className="sessions-page">
      <div className="page-header">
        <h2>Sessions ({sessions.length})</h2>
        <div className="refresh-controls">
          <label className="auto-refresh-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto
          </label>
          <button className="refresh-btn" onClick={fetchSessionsSilent} title="Refresh">
            ↻
          </button>
        </div>
      </div>

      <div className="sessions-list">
        {sessions.map((session) => (
          <div
            key={session.id}
            className="session-item"
            onClick={() => setSearchParams({ id: session.id })}
          >
            <div className="session-header">
              <span className="session-channel">{session.channel}</span>
              <span className="session-time">
                {formatRelativeTime(session.last_active_at)}
              </span>
            </div>
            <div className="session-target">{session.id}</div>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="empty-state">No sessions yet</div>
        )}
      </div>
    </div>
  );
}

export default Sessions;
