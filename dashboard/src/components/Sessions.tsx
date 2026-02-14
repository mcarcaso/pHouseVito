import { useState, useEffect } from 'react';
import './Sessions.css';

interface SessionConfig {
  streamMode?: string;
}

interface Session {
  id: string;
  channel: string;
  channel_target: string;
  created_at: number;
  last_active_at: number;
  config: string;
}

interface Message {
  id: number;
  session_id: string;
  role: string;
  content: string;
  timestamp: number;
  compacted: boolean;
}

type SortField = 'id' | 'role' | 'timestamp' | 'compacted';
type SortDirection = 'asc' | 'desc';

function Sessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [displayedMessages, setDisplayedMessages] = useState<Message[]>([]);
  const [sessionConfig, setSessionConfig] = useState<SessionConfig>({});
  const [loading, setLoading] = useState(true);
  const [messageOffset, setMessageOffset] = useState(0);
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');
  const MESSAGE_PAGE_SIZE = 20;

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    if (selectedSession) {
      fetchMessages(selectedSession);
      fetchSessionConfig(selectedSession);
    }
  }, [selectedSession]);

  useEffect(() => {
    // Sort and paginate messages
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
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      setLoading(false);
    }
  };

  const fetchMessages = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/messages`);
      const data = await res.json();
      setAllMessages(data);
      setMessageOffset(0); // Reset pagination when switching sessions
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
  };

  const fetchSessionConfig = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/config`);
      const data = await res.json();
      setSessionConfig(data);
    } catch (err) {
      console.error('Failed to fetch session config:', err);
    }
  };

  const updateStreamMode = async (mode: string) => {
    if (!selectedSession) return;
    const value = mode || undefined; // empty string = use channel default
    await fetch(`/api/sessions/${selectedSession}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamMode: value }),
    });
    setSessionConfig((prev) => ({ ...prev, streamMode: value }));
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    setMessageOffset(0); // Reset pagination when sorting
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

    if (days === 0) {
      return date.toLocaleTimeString();
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return `${days} days ago`;
    } else {
      return date.toLocaleDateString();
    }
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

  if (loading) {
    return <div className="sessions-container">Loading sessions...</div>;
  }

  const handleSessionSelect = (sessionId: string) => {
    setSelectedSession(sessionId);
    setMobileView('detail');
  };

  const handleBackToList = () => {
    setMobileView('list');
  };

  return (
    <div className={`sessions-container mobile-view-${mobileView}`}>
      <div className="sessions-list">
        <h2>All Sessions ({sessions.length})</h2>
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`session-item ${selectedSession === session.id ? 'active' : ''}`}
            onClick={() => handleSessionSelect(session.id)}
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

      <div className="session-details">
        {selectedSession ? (
          <>
            <div className="session-details-header">
              <button className="back-button" onClick={handleBackToList}>
                ← Back
              </button>
              <h2>Messages ({allMessages.length})</h2>
              <div className="session-config">
                <label className="config-label">Stream mode</label>
                <select
                  className="config-select"
                  value={sessionConfig.streamMode || ''}
                  onChange={(e) => updateStreamMode(e.target.value)}
                >
                  <option value="">Channel default</option>
                  <option value="stream">Stream</option>
                  <option value="bundled">Bundled</option>
                  <option value="final">Final</option>
                </select>
              </div>
            </div>
            
            {allMessages.length > 0 ? (
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
                          Timestamp {getSortIcon('timestamp')}
                        </th>
                        <th>Content</th>
                        <th onClick={() => handleSort('compacted')} className="sortable">
                          Compacted {getSortIcon('compacted')}
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
                            <td className="message-content">
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
                      Load More Messages ({displayedMessages.length} of {allMessages.length})
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state">No messages in this session</div>
            )}
          </>
        ) : (
          <div className="empty-state">Select a session to view messages</div>
        )}
      </div>
    </div>
  );
}

export default Sessions;
