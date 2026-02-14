import { useState, useEffect } from 'react';
import './Secrets.css';

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
    return <div className="secrets-page">Loading secrets...</div>;
  }

  const systemSecrets = secrets.filter((s) => s.system);
  const userSecrets = secrets.filter((s) => !s.system);

  const renderSecret = (secret: Secret) => (
    <div key={secret.key} className={`secret-item ${secret.system ? 'secret-system' : ''}`}>
      <div className="secret-key-row">
        <span className="secret-key">{secret.key}</span>
        {secret.system && <span className="secret-badge">System</span>}
        {!secret.value && <span className="secret-badge secret-badge-empty">Not set</span>}
      </div>
      {secret.description && (
        <div className="secret-description">{secret.description}</div>
      )}
      {editingKey === secret.key ? (
        <div className="secret-edit-row">
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') updateSecret(secret.key);
              if (e.key === 'Escape') setEditingKey(null);
            }}
            className="secrets-input value-input"
            placeholder={secret.system ? 'Paste your key here...' : 'value'}
            autoFocus
          />
          <button onClick={() => updateSecret(secret.key)} className="secrets-btn save-btn">Save</button>
          <button onClick={() => setEditingKey(null)} className="secrets-btn cancel-btn">Cancel</button>
        </div>
      ) : (
        <div className="secret-value-row">
          <span className="secret-value">
            {!secret.value ? '—' : revealed.has(secret.key) ? secret.value : '••••••••'}
          </span>
          <div className="secret-actions">
            {secret.value && (
              <button onClick={() => toggleReveal(secret.key)} className="secrets-btn">
                {revealed.has(secret.key) ? 'Hide' : 'Reveal'}
              </button>
            )}
            <button onClick={() => startEditing(secret)} className="secrets-btn">
              {secret.value ? 'Edit' : 'Set'}
            </button>
            {!secret.system && (
              <button onClick={() => deleteSecret(secret.key)} className="secrets-btn delete-btn">Delete</button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="secrets-page">
      <div className="page-header">
        <h2>Secrets</h2>
      </div>

      <div className="secrets-content">
        <p className="secrets-subtitle">
          Environment variables from .env — changes apply immediately
        </p>

        {systemSecrets.length > 0 && (
          <>
            <h3 className="secrets-section-title">System</h3>
            <div className="secrets-list">
              {systemSecrets.map(renderSecret)}
            </div>
          </>
        )}

        <h3 className="secrets-section-title">Custom</h3>
        <div className="secrets-add">
          <input
            type="text"
            placeholder="KEY_NAME"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
            className="secrets-input key-input"
          />
          <input
            type="text"
            placeholder="value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSecret()}
            className="secrets-input value-input"
          />
          <button onClick={addSecret} className="secrets-btn add-btn" disabled={!newKey.trim() || !newValue}>
            Add
          </button>
        </div>

        <div className="secrets-list">
          {userSecrets.map(renderSecret)}
          {userSecrets.length === 0 && (
            <div className="empty-state">
              <p>No custom secrets</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Secrets;
