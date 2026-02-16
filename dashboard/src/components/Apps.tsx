import { useState, useEffect } from 'react';

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

const statusDotClass: Record<string, string> = {
  online: 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.4)]',
  stopped: 'bg-neutral-500',
  errored: 'bg-red-400',
  unknown: 'bg-red-400',
};

const statusBadgeClass: Record<string, string> = {
  online: 'text-green-400 bg-green-400/10',
  stopped: 'text-neutral-500 bg-neutral-500/10',
  errored: 'text-red-400 bg-red-400/10',
  unknown: 'text-red-400 bg-red-400/10',
};

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
    <div className="flex flex-col pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white">Apps ({apps.length})</h2>
      </div>

      <div className="p-4 sm:p-6 max-w-[600px] sm:max-w-[700px] mx-auto w-full">
        {loading ? (
          <div className="text-center text-neutral-500 py-12">Loading...</div>
        ) : apps.length === 0 ? (
          <div className="text-center text-neutral-500 py-12">No apps deployed yet</div>
        ) : (
          <div className="flex flex-col gap-3">
            {apps.map(app => (
              <div
                key={app.name}
                className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 sm:p-5 hover:border-neutral-700 transition-colors"
              >
                {/* Header row */}
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotClass[app.status] || statusDotClass.unknown}`} />
                    <span className="text-base font-semibold text-white">{app.name}</span>
                  </div>
                  <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md ${statusBadgeClass[app.status] || statusBadgeClass.unknown}`}>
                    {app.status}
                  </span>
                </div>

                {app.description && (
                  <p className="text-sm text-neutral-500 mb-2 leading-relaxed">{app.description}</p>
                )}

                <a
                  href={app.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-sm text-blue-400 hover:underline mb-3"
                >
                  {app.url.replace('https://', '')} ↗
                </a>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
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
