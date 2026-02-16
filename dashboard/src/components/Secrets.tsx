import { useState, useEffect } from 'react';

interface Secret {
  key: string;
  value: string;
  system?: boolean;
  description?: string;
}

function Secrets() {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchSecrets();
  }, []);

  const fetchSecrets = async () => {
    try {
      const res = await fetch('/api/secrets');
      const data = await res.json();
      setSecrets(data);
    } catch (err) {
      console.error('Failed to fetch secrets:', err);
    } finally {
      setLoading(false);
    }
  };

  const addSecret = async () => {
    const key = newKey.trim();
    if (!key || !newValue) return;
    await fetch(`/api/secrets/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: newValue }),
    });
    setNewKey('');
    setNewValue('');
    fetchSecrets();
  };

  const updateSecret = async (key: string) => {
    await fetch(`/api/secrets/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: editValue }),
    });
    setEditingKey(null);
    setEditValue('');
    fetchSecrets();
  };

  const deleteSecret = async (key: string) => {
    const res = await fetch(`/api/secrets/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
    if (!res.ok) return;
    revealed.delete(key);
    setRevealed(new Set(revealed));
    fetchSecrets();
  };

  const toggleReveal = (key: string) => {
    const next = new Set(revealed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setRevealed(next);
  };

  const startEditing = (secret: Secret) => {
    setEditingKey(secret.key);
    setEditValue(secret.value);
  };

  if (loading) {
    return <div className="flex flex-col pb-8 text-neutral-400 p-4">Loading secrets...</div>;
  }

  const systemSecrets = secrets.filter((s) => s.system);
  const userSecrets = secrets.filter((s) => !s.system);

  const renderSecret = (secret: Secret) => (
    <div
      key={secret.key}
      className={`bg-neutral-900 border border-neutral-800 rounded-lg p-4 ${secret.system ? 'border-l-2 border-l-blue-600/50' : ''}`}
    >
      {/* Key row */}
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-sm font-semibold text-amber-500 font-mono">{secret.key}</span>
        {secret.system && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-950 text-blue-400 border border-blue-900 uppercase tracking-wide">
            System
          </span>
        )}
        {!secret.value && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/50 text-amber-500 border border-amber-900/50 uppercase tracking-wide">
            Not set
          </span>
        )}
      </div>

      {secret.description && (
        <div className="text-xs text-neutral-600 mb-2">{secret.description}</div>
      )}

      {editingKey === secret.key ? (
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') updateSecret(secret.key);
              if (e.key === 'Escape') setEditingKey(null);
            }}
            className="flex-1 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-white text-sm sm:text-base font-mono focus:outline-none focus:border-blue-600 transition-colors"
            placeholder={secret.system ? 'Paste your key here...' : 'value'}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={() => updateSecret(secret.key)}
              className="flex-1 sm:flex-none px-3 py-2 bg-green-950 border border-green-800 rounded-md text-green-400 text-sm cursor-pointer hover:bg-green-900/50 transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => setEditingKey(null)}
              className="flex-1 sm:flex-none px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-400 text-sm cursor-pointer hover:bg-neutral-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span className="font-mono text-neutral-500 text-sm truncate min-w-0">
            {!secret.value ? '—' : revealed.has(secret.key) ? secret.value : '••••••••'}
          </span>
          <div className="flex gap-1 shrink-0 justify-end">
            {secret.value && (
              <button
                onClick={() => toggleReveal(secret.key)}
                className="px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-400 text-xs cursor-pointer hover:bg-neutral-700 hover:border-neutral-600 transition-colors"
              >
                {revealed.has(secret.key) ? 'Hide' : 'Reveal'}
              </button>
            )}
            <button
              onClick={() => startEditing(secret)}
              className="px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-400 text-xs cursor-pointer hover:bg-neutral-700 hover:border-neutral-600 transition-colors"
            >
              {secret.value ? 'Edit' : 'Set'}
            </button>
            {!secret.system && (
              <button
                onClick={() => deleteSecret(secret.key)}
                className="px-2.5 py-1.5 bg-red-950/50 border border-red-900/50 rounded-md text-red-400 text-xs cursor-pointer hover:bg-red-950 hover:border-red-700 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800 sticky top-0 bg-black/95 backdrop-blur z-10">
        <h2 className="text-lg font-semibold text-white">Secrets</h2>
      </div>

      <div className="p-4 max-w-3xl">
        <p className="text-neutral-500 text-sm mb-5">
          Environment variables from .env — changes apply immediately
        </p>

        {systemSecrets.length > 0 && (
          <>
            <h3 className="text-xs uppercase tracking-wide text-neutral-600 mb-2">System</h3>
            <div className="bg-neutral-950 rounded-lg p-3 mb-4 space-y-2">
              {systemSecrets.map(renderSecret)}
            </div>
          </>
        )}

        <h3 className="text-xs uppercase tracking-wide text-neutral-600 mb-2 mt-4">Custom</h3>

        {/* Add form */}
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            type="text"
            placeholder="KEY_NAME"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
            className="w-full sm:w-44 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2.5 sm:py-2 text-white text-base sm:text-sm font-mono focus:outline-none focus:border-blue-600 transition-colors"
          />
          <input
            type="text"
            placeholder="value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSecret()}
            className="flex-1 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2.5 sm:py-2 text-white text-base sm:text-sm focus:outline-none focus:border-blue-600 transition-colors"
          />
          <button
            onClick={addSecret}
            disabled={!newKey.trim() || !newValue}
            className="px-4 py-2.5 sm:py-2 bg-green-950 border border-green-800 rounded-md text-green-400 text-sm cursor-pointer hover:bg-green-900/50 transition-colors disabled:opacity-40 disabled:cursor-default"
          >
            Add
          </button>
        </div>

        <div className="bg-neutral-950 rounded-lg p-3 space-y-2">
          {userSecrets.map(renderSecret)}
          {userSecrets.length === 0 && (
            <div className="text-center py-8 text-neutral-600">
              No custom secrets
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Secrets;
