import { useState, useEffect } from 'react';
import './Apps.css';

interface App {
  name: string;
  description: string;
  port: number;
  url: string;
  createdAt: string;
  status: string;
  uptime: number | null;
  restarts: number;
  memory: number | null;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Apps() {
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchApps = () => {
    fetch('/api/apps')
      .then(r => r.json())
      .then(data => {
        setApps(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchApps();
    const interval = setInterval(fetchApps, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="apps-page">
      <div className="page-header">
        <h2>Apps ({apps.length})</h2>
      </div>

      <div className="apps-content">
        {loading ? (
          <div className="apps-loading">Loading...</div>
        ) : apps.length === 0 ? (
          <div className="apps-empty">No apps deployed yet</div>
        ) : (
          <div className="apps-list">
            {apps.map(app => (
              <div key={app.name} className="app-card">
                <div className="app-card-header">
                  <div className="app-name-row">
                    <span className={`app-status-dot ${app.status}`} />
                    <span className="app-name">{app.name}</span>
                  </div>
                  <span className={`app-status-badge ${app.status}`}>
                    {app.status}
                  </span>
                </div>

                {app.description && (
                  <p className="app-description">{app.description}</p>
                )}

                <a
                  href={app.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="app-url"
                >
                  {app.url.replace('https://', '')} ↗
                </a>

                <div className="app-meta">
                  <span>Port {app.port}</span>
                  {app.uptime !== null && <span>Up {formatUptime(app.uptime)}</span>}
                  {app.memory !== null && <span>{formatBytes(app.memory)}</span>}
                  {app.restarts > 0 && <span>{app.restarts} restarts</span>}
                  {app.createdAt && <span>{formatDate(app.createdAt)}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
