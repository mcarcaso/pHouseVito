import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import './Traces.css';

interface TraceListItem {
  id: number;
  session_id: string;
  channel: string;
  timestamp: number;
  user_message: string;
  model: string | null;
}

interface TraceDetail extends TraceListItem {
  system_prompt: string;
}

function Traces() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTrace = searchParams.get('id');

  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [traceDetail, setTraceDetail] = useState<TraceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchTraces = useCallback(async () => {
    try {
      const res = await fetch('/api/traces?limit=100');
      const data = await res.json();
      setTraces(data);
    } catch (err) {
      console.error('Failed to fetch traces:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTraceDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/traces/${id}`);
      const data = await res.json();
      setTraceDetail(data);
    } catch (err) {
      console.error('Failed to fetch trace detail:', err);
    }
  }, []);

  useEffect(() => {
    if (selectedTrace) {
      fetchTraceDetail(selectedTrace);
    } else {
      fetchTraces();
    }
  }, [selectedTrace, fetchTraces, fetchTraceDetail]);

  // Auto-refresh list view
  useEffect(() => {
    if (!autoRefresh || selectedTrace) return;
    const interval = setInterval(fetchTraces, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedTrace, fetchTraces]);

  const formatDate = (ts: number) => new Date(ts).toLocaleString();

  const truncate = (text: string, max: number = 100) =>
    text.length <= max ? text : text.substring(0, max) + '…';

  // ── Detail view ──
  if (selectedTrace && traceDetail) {
    return (
      <div className="traces-page">
        <div className="page-header">
          <button className="back-link" onClick={() => { setSearchParams({}); setTraceDetail(null); }}>
            ‹ Traces
          </button>
          <h2>Trace #{traceDetail.id}</h2>
        </div>

        <div className="trace-detail">
          <div className="trace-summary-bar">
            <div className="trace-meta-row">
              <span className="trace-meta-item">
                <span className="meta-label">Session</span>
                <span className="meta-value">{traceDetail.session_id}</span>
              </span>
              <span className="trace-meta-item">
                <span className="meta-label">Channel</span>
                <span className="meta-value">{traceDetail.channel || '—'}</span>
              </span>
              <span className="trace-meta-item">
                <span className="meta-label">Time</span>
                <span className="meta-value">{formatDate(traceDetail.timestamp)}</span>
              </span>
              <span className="trace-meta-item">
                <span className="meta-label">Model</span>
                <span className="meta-value">{traceDetail.model || '—'}</span>
              </span>
              <span className="trace-meta-item">
                <span className="meta-label">Prompt Size</span>
                <span className="meta-value">{traceDetail.system_prompt.length.toLocaleString()} chars</span>
              </span>
            </div>
          </div>

          {/* User Message */}
          <div className="trace-section">
            <div className="section-header">
              <span className="section-title">💬 User Message</span>
            </div>
            <div className="section-body">
              <pre className="trace-content">{traceDetail.user_message}</pre>
            </div>
          </div>

          {/* System Prompt */}
          <div className="trace-section">
            <div className="section-header">
              <span className="section-title">📋 System Prompt</span>
              <span className="section-badge">{traceDetail.system_prompt.length.toLocaleString()} chars</span>
            </div>
            <div className="section-body">
              <pre className="trace-content system-prompt">{traceDetail.system_prompt}</pre>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Loading state for detail
  if (selectedTrace && !traceDetail) {
    return <div className="traces-page">Loading trace...</div>;
  }

  // ── List view ──
  if (loading) {
    return <div className="traces-page">Loading traces...</div>;
  }

  return (
    <div className="traces-page">
      <div className="page-header">
        <h2>Traces ({traces.length})</h2>
        <div className="refresh-controls">
          <label className="auto-refresh-toggle">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto
          </label>
          <button className="refresh-btn" onClick={fetchTraces} title="Refresh">
            ↻
          </button>
        </div>
      </div>

      <div className="traces-list">
        {traces.map((trace) => (
          <div
            key={trace.id}
            className="trace-item"
            onClick={() => setSearchParams({ id: trace.id.toString() })}
          >
            <div className="trace-item-header">
              <span className="trace-item-id">#{trace.id}</span>
              <span className="trace-item-channel">{trace.channel || '—'}</span>
              <span className="trace-item-model">{trace.model || '—'}</span>
              <span className="trace-item-time">
                {formatDate(trace.timestamp)}
              </span>
            </div>
            <div className="trace-item-message">
              {truncate(trace.user_message, 120)}
            </div>
          </div>
        ))}
        {traces.length === 0 && (
          <div className="empty-state">No traces recorded yet. Send a message to start capturing.</div>
        )}
      </div>
    </div>
  );
}

export default Traces;
