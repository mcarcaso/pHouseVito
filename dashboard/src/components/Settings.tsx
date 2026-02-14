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
    compactionThreshold: number;
    includeToolsInCurrentSession?: boolean;
    includeToolsInCrossSession?: boolean;
    showArchivedInCrossSession?: boolean;
  };
}

interface ModelOption {
  id: string;
}

interface ProviderKeyInfo {
  envVar: string;
  description: string;
}

interface ProvidersResponse {
  providers: string[];
  keyStatus: Record<string, boolean>;
  keyInfo: Record<string, ProviderKeyInfo>;
}

function Settings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({});
  const [keyInfo, setKeyInfo] = useState<Record<string, ProviderKeyInfo>>({});
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    // Load config and providers in parallel
    Promise.all([
      fetch('/api/config').then(r => r.json()),
      fetch('/api/models/providers').then(r => r.json()) as Promise<ProvidersResponse>,
    ]).then(([configData, providerData]) => {
      // Ensure model config exists with defaults
      const safeConfig = {
        ...configData,
        model: configData.model || { provider: '', name: '' },
      };
      setConfig(safeConfig);
      setProviders(providerData.providers);
      setKeyStatus(providerData.keyStatus || {});
      setKeyInfo(providerData.keyInfo || {});
      // Load models for current provider
      if (safeConfig.model.provider) {
        loadModelsForProvider(safeConfig.model.provider);
      }
    }).catch(err => console.error('Failed to load:', err));
  }, []);

  const loadModelsForProvider = async (provider: string) => {
    setLoadingModels(true);
    try {
      const res = await fetch(`/api/models/${provider}`);
      const data = await res.json();
      setModels(data);
    } catch (err) {
      console.error('Failed to load models:', err);
      setModels([]);
    }
    setLoadingModels(false);
  };

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

  const handleProviderChange = (provider: string) => {
    setConfig({ ...config, model: { provider, name: '' } });
    loadModelsForProvider(provider);
  };

  const handleModelChange = (name: string) => {
    setConfig({ ...config, model: { ...config.model, name } });
  };

  // Group providers into "popular" and "other"
  const popularProviders = ['anthropic', 'openai', 'google', 'xai', 'groq', 'mistral', 'openrouter'];
  const sortedProviders = [
    ...popularProviders.filter(p => providers.includes(p)),
    ...providers.filter(p => !popularProviders.includes(p)).sort(),
  ];

  // Get key status indicator for a provider
  const getKeyIndicator = (provider: string) => {
    if (!(provider in keyStatus)) return null; // No info about this provider
    return keyStatus[provider] ? '✓' : '✗';
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
          <h3>Global Model</h3>
          <p className="section-desc">Default model used for all sessions unless overridden.</p>

          <div className="setting-row">
            <label>Provider</label>
            <select
              className="model-select"
              value={config.model.provider}
              onChange={(e) => handleProviderChange(e.target.value)}
            >
              <option value="">Select provider...</option>
              {sortedProviders.map(p => {
                const indicator = getKeyIndicator(p);
                const hasKey = keyStatus[p];
                return (
                  <option key={p} value={p}>
                    {indicator ? `${indicator} ` : ''}{p}{!hasKey && indicator ? ' (no key)' : ''}
                  </option>
                );
              })}
            </select>
            {config.model.provider && keyInfo[config.model.provider] && (
              <span className={`setting-hint key-hint ${keyStatus[config.model.provider] ? 'has-key' : 'no-key'}`}>
                {keyStatus[config.model.provider] 
                  ? `✓ API key configured (${keyInfo[config.model.provider].envVar})`
                  : `✗ Missing: ${keyInfo[config.model.provider].envVar} — add in Secrets`
                }
              </span>
            )}
          </div>

          <div className="setting-row">
            <label>Model</label>
            {loadingModels ? (
              <span className="setting-hint">Loading models...</span>
            ) : (
              <select
                className="model-select"
                value={config.model.name}
                onChange={(e) => handleModelChange(e.target.value)}
              >
                <option value="">Select model...</option>
                {models.map(m => (
                  <option key={m.id} value={m.id}>{m.id}</option>
                ))}
              </select>
            )}
          </div>

          {config.model.provider && config.model.name && (
            <div className={`current-model-badge ${keyStatus[config.model.provider] ? '' : 'no-key'}`}>
              {keyStatus[config.model.provider] ? '🤖' : '⚠️'} {config.model.provider}/{config.model.name}
            </div>
          )}
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
            <span className="setting-hint">Messages per other session (cross-session context)</span>
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
