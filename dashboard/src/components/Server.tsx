import { useState, useEffect } from 'react';
import './Server.css';

interface ServerStatus {
  uptime: number;
  pid: number;
  nodeVersion: string;
  memoryUsage: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
  };
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export default function Server() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);

  const fetchStatus = () => {
    fetch('/api/server/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRestart = async () => {
    if (!confirmRestart) {
      setConfirmRestart(true);
      setTimeout(() => setConfirmRestart(false), 4000);
      return;
    }

    setRestarting(true);
    setConfirmRestart(false);

    try {
      await fetch('/api/server/restart', { method: 'POST' });
    } catch {
      // Expected — server dies mid-request
    }

    // Poll until server comes back
    const poll = setInterval(async () => {
      try {
        const res = await fetch('/api/server/status');
        if (res.ok) {
          clearInterval(poll);
          setRestarting(false);
          fetchStatus();
        }
      } catch {
        // Still restarting
      }
    }, 1000);

    // Stop polling after 30s
    setTimeout(() => {
      clearInterval(poll);
      setRestarting(false);
    }, 30000);
  };

  return (
    <div className="server-page">
      <div className="page-header">
        <h2>Server</h2>
      </div>

      <div className="server-content">
        {/* Status Card */}
        <div className="server-card">
          <h3 className="server-card-title">Status</h3>
          {status ? (
            <div className="server-stats">
              <div className="server-stat">
                <span className="stat-label">Status</span>
                <span className="stat-value stat-online">● Online</span>
              </div>
              <div className="server-stat">
                <span className="stat-label">Uptime</span>
                <span className="stat-value">{formatUptime(status.uptime)}</span>
              </div>
              <div className="server-stat">
                <span className="stat-label">PID</span>
                <span className="stat-value">{status.pid}</span>
              </div>
              <div className="server-stat">
                <span className="stat-label">Node</span>
                <span className="stat-value">{status.nodeVersion}</span>
              </div>
              <div className="server-stat">
                <span className="stat-label">Memory (RSS)</span>
                <span className="stat-value">{formatBytes(status.memoryUsage.rss)}</span>
              </div>
              <div className="server-stat">
                <span className="stat-label">Heap Used</span>
                <span className="stat-value">{formatBytes(status.memoryUsage.heapUsed)} / {formatBytes(status.memoryUsage.heapTotal)}</span>
              </div>
            </div>
          ) : (
            <div className="server-stats">
              <div className="server-stat">
                <span className="stat-label">Status</span>
                <span className="stat-value stat-offline">● Offline</span>
              </div>
            </div>
          )}
        </div>

        {/* Restart Card */}
        <div className="server-card">
          <h3 className="server-card-title">Restart</h3>
          <p className="server-card-desc">
            Restart the Vito server via PM2. The server will be briefly unavailable.
          </p>

          {restarting ? (
            <div className="restart-status">
              <div className="restart-spinner" />
              <span>Restarting server...</span>
            </div>
          ) : (
            <button
              className={`restart-btn ${confirmRestart ? 'confirm' : ''}`}
              onClick={handleRestart}
            >
              {confirmRestart ? 'Are you sure? Click again to confirm' : 'Restart Server'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
