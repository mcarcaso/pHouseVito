import { useState, useEffect } from 'react';
import './Settings.css';

interface Config {
  model: {
    provider: string;
    name: string;
  };
  memory: {
    currentSessionLimit: number;
    crossSessionLimit: number;
    memoriesLimit: number;
    compactionThreshold: number;
    includeToolsInCurrentSession?: boolean;
    includeToolsInCrossSession?: boolean;
    showArchivedInCrossSession?: boolean;
  };
  embeddings: {
    provider: string;
    model: string;
  };
}

function Settings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => setConfig(data))
      .catch((err) => console.error('Failed to load config:', err));
  }, []);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          memory: config.memory,
          embeddings: config.embeddings,
        }),
      });
      const updated = await res.json();
      setConfig(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save config:', err);
    }
    setSaving(false);
  };

  if (!config) return <div className="settings-page">Loading...</div>;

  const updateMemory = (key: string, value: number | boolean) => {
    setConfig({ ...config, memory: { ...config.memory, [key]: value } });
  };

  const updateModel = (key: string, value: string) => {
    setConfig({ ...config, model: { ...config.model, [key]: value } });
  };

  return (
    <div className="settings-page">
      <div className="page-header">
        <h2>Settings</h2>
        <button className="header-save-btn" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>

      <div className="settings-content">
        <section className="settings-section">
          <h3>Model</h3>
          <div className="setting-row">
            <label>Provider</label>
            <input
              type="text"
              value={config.model.provider}
              onChange={(e) => updateModel('provider', e.target.value)}
            />
          </div>
          <div className="setting-row">
            <label>Model name</label>
            <input
              type="text"
              value={config.model.name}
              onChange={(e) => updateModel('name', e.target.value)}
            />
          </div>
        </section>

        <section className="settings-section">
          <h3>Context Window</h3>
          <p className="section-desc">Controls what goes into the system prompt.</p>

          <div className="setting-row">
            <label>Current session messages</label>
            <input
              type="number"
              value={config.memory.currentSessionLimit}
              onChange={(e) => updateMemory('currentSessionLimit', parseInt(e.target.value) || 0)}
              min={0}
            />
            <span className="setting-hint">Recent messages from the active session</span>
          </div>

          <div className="setting-row">
            <label>Include tool calls (current)</label>
            <input
              type="checkbox"
              checked={config.memory.includeToolsInCurrentSession ?? true}
              onChange={(e) => updateMemory('includeToolsInCurrentSession', e.target.checked)}
            />
            <span className="setting-hint">Show tool calls in session transcript</span>
          </div>

          <div className="setting-row">
            <label>Cross-session messages</label>
            <input
              type="number"
              value={config.memory.crossSessionLimit}
              onChange={(e) => updateMemory('crossSessionLimit', parseInt(e.target.value) || 0)}
              min={0}
            />
            <span className="setting-hint">Recent messages from other sessions</span>
          </div>

          <div className="setting-row">
            <label>Include tool calls (cross)</label>
            <input
              type="checkbox"
              checked={config.memory.includeToolsInCrossSession ?? false}
              onChange={(e) => updateMemory('includeToolsInCrossSession', e.target.checked)}
            />
            <span className="setting-hint">Show tool calls from other sessions</span>
          </div>

          <div className="setting-row">
            <label>Show archived in cross-session</label>
            <input
              type="checkbox"
              checked={config.memory.showArchivedInCrossSession ?? false}
              onChange={(e) => updateMemory('showArchivedInCrossSession', e.target.checked)}
            />
            <span className="setting-hint">Include archived messages from other sessions</span>
          </div>

          <div className="setting-row">
            <label>Long-term memories</label>
            <input
              type="number"
              value={config.memory.memoriesLimit}
              onChange={(e) => updateMemory('memoriesLimit', parseInt(e.target.value) || 0)}
              min={0}
            />
            <span className="setting-hint">Max memories via semantic search</span>
          </div>
        </section>

        <section className="settings-section">
          <h3>Compaction</h3>
          <p className="section-desc">Summarize old messages into long-term memories.</p>

          <div className="setting-row">
            <label>Compaction threshold</label>
            <input
              type="number"
              value={config.memory.compactionThreshold}
              onChange={(e) => updateMemory('compactionThreshold', parseInt(e.target.value) || 0)}
              min={0}
              step={50}
            />
            <span className="setting-hint">Trigger after this many uncompacted messages</span>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Settings;
