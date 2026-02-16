import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

interface SessionConfig {
  streamMode?: string;
  harness?: string;
  model?: {
    provider: string;
    name: string;
  };
  'pi-coding-agent'?: {
    model?: {
      provider: string;
      name: string;
    };
    thinkingLevel?: string;
  };
  'claude-code'?: {
    model?: string;
    cwd?: string;
    permissionMode?: string;
  };
}

interface Session {
  id: string;
  channel: string;
  channel_target: string;
  created_at: number;
  last_active_at: number;
  config: string;
}

interface ModelOption {
  id: string;
}

interface AuthStatus {
  hasAuth: boolean;
  authType?: 'apiKey' | 'oauth';
}

interface HarnessInfo {
  name: string;
  description: string;
  config: any;
  isDefault: boolean;
}

interface HarnessesData {
  default: string;
  available: Record<string, HarnessInfo>;
}

const selectClass = "w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-sm focus:outline-none focus:border-blue-600 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23666%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.75rem_center] pr-8";

function SessionSettings() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  const [session, setSession] = useState<Session | null>(null);
  const [config, setConfig] = useState<SessionConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  
  // Harness data
  const [harnessData, setHarnessData] = useState<HarnessesData | null>(null);
  const [globalDefault, setGlobalDefault] = useState<string>('pi-coding-agent');
  
  // Model selection
  const [providers, setProviders] = useState<string[]>([]);
  const [authStatus, setAuthStatus] = useState<Record<string, AuthStatus>>({});
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  
  // Derived state for the form
  const selectedHarness = config.harness || globalDefault;
  const piConfig = config['pi-coding-agent'] || {};
  const claudeCodeConfig = config['claude-code'] || {};
  const legacyModel = config.model;
  const effectiveModel = piConfig.model || legacyModel;
  
  useEffect(() => {
    if (!id) return;
    
    Promise.all([
      fetch(`/api/sessions/${id}/config`).then(r => r.json()),
      fetch('/api/harnesses').then(r => r.json()),
      fetch('/api/models/providers').then(r => r.json()),
      // Get session metadata
      fetch('/api/sessions').then(r => r.json()).then(sessions => 
        sessions.find((s: Session) => s.id === id)
      ),
    ]).then(([configData, harnessesData, providerData, sessionData]) => {
      setConfig(configData);
      setHarnessData(harnessesData);
      setGlobalDefault(harnessesData.default || 'pi-coding-agent');
      setProviders(providerData.providers || []);
      setAuthStatus(providerData.authStatus || {});
      setSession(sessionData || null);
      
      // Load models for current provider
      const currentModel = configData['pi-coding-agent']?.model || configData.model;
      if (currentModel?.provider) {
        loadModelsForProvider(currentModel.provider);
      }
      
      setLoading(false);
    }).catch(err => {
      console.error('Failed to load session settings:', err);
      setLoading(false);
    });
  }, [id]);
  
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
  
  const saveConfig = async (newConfig: SessionConfig) => {
    if (!id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sessions/${id}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
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
  
  const handleStreamModeChange = (mode: string) => {
    const newConfig = { ...config };
    if (mode) {
      newConfig.streamMode = mode;
    } else {
      (newConfig as any).streamMode = null;
    }
    setConfig(newConfig);
    saveConfig(newConfig);
  };
  
  const handleHarnessChange = (harness: string) => {
    const newConfig = { ...config };
    if (harness && harness !== globalDefault) {
      newConfig.harness = harness;
    } else {
      // Send null so the backend merge removes the key
      (newConfig as any).harness = null;
    }
    setConfig(newConfig);
    saveConfig(newConfig);
  };
  
  const handleProviderChange = (provider: string) => {
    // Migrate to new structure
    const newConfig = { ...config };
    delete newConfig.model; // Remove legacy
    
    if (provider) {
      newConfig['pi-coding-agent'] = {
        ...newConfig['pi-coding-agent'],
        model: { provider, name: '' },
      };
      loadModelsForProvider(provider);
    } else {
      // Clear model override entirely
      if (newConfig['pi-coding-agent']) {
        delete newConfig['pi-coding-agent'].model;
        if (Object.keys(newConfig['pi-coding-agent']).length === 0) {
          delete newConfig['pi-coding-agent'];
        }
      }
    }
    
    setConfig(newConfig);
    // Don't save yet - wait for model selection
  };
  
  const handleModelChange = (name: string) => {
    const newConfig = { ...config };
    delete newConfig.model; // Remove legacy
    
    const currentProvider = piConfig.model?.provider || effectiveModel?.provider;
    if (currentProvider && name) {
      newConfig['pi-coding-agent'] = {
        ...newConfig['pi-coding-agent'],
        model: { provider: currentProvider, name },
      };
      setConfig(newConfig);
      saveConfig(newConfig);
    }
  };
  
  const clearModelOverride = () => {
    const newConfig = { ...config };
    delete newConfig.model;
    if (newConfig['pi-coding-agent']) {
      delete newConfig['pi-coding-agent'].model;
      if (Object.keys(newConfig['pi-coding-agent']).length === 0) {
        delete newConfig['pi-coding-agent'];
      }
    }
    setConfig(newConfig);
    saveConfig(newConfig);
  };
  
  if (loading) {
    return <div className="p-4 text-neutral-400">Loading...</div>;
  }
  
  if (!id) {
    return <div className="p-4 text-red-400">No session ID provided</div>;
  }
  
  // Filter providers to those with auth
  const popularProviders = ['anthropic', 'openai', 'google', 'xai', 'groq', 'mistral', 'openrouter'];
  const availableProviders = providers.filter(p => authStatus[p]?.hasAuth === true);
  const sortedProviders = [
    ...popularProviders.filter(p => availableProviders.includes(p)),
    ...availableProviders.filter(p => !popularProviders.includes(p)).sort(),
  ];
  
  const availableHarnesses = harnessData?.available ? Object.keys(harnessData.available) : ['pi-coding-agent'];
  
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };
  
  // Check if there are any overrides
  const hasOverrides = config.streamMode || config.harness || config['pi-coding-agent'] || config.model;
  
  return (
    <div className="flex flex-col pb-8">
      {/* Header */}
      <div className="sticky top-[52px] md:top-0 z-20 bg-neutral-950/95 backdrop-blur border-b border-neutral-800">
        <div className="flex items-center px-4 py-3 gap-3">
          <button
            className="bg-transparent border-none text-blue-500 text-2xl cursor-pointer px-2 py-1 leading-none hover:text-blue-400"
            onClick={() => navigate(`/sessions?id=${id}`)}
          >
            ‹
          </button>
          <h2 className="text-lg font-semibold text-white m-0">Session Settings</h2>
          {saving && <span className="text-xs text-neutral-500 ml-auto">Saving...</span>}
          {saved && <span className="text-xs text-green-400 ml-auto animate-[fadeIn_0.2s]">✓ Saved</span>}
        </div>
      </div>
      
      <div className="p-4 max-w-2xl">
        {/* Session Info */}
        <section className="bg-[#151515] border border-[#222] rounded-xl p-5 mb-4">
          <h3 className="text-base font-semibold text-white mb-3">Session Info</h3>
          <div className="space-y-2 text-sm">
            <div className="flex gap-2">
              <span className="text-neutral-500 min-w-[80px]">ID:</span>
              <span className="text-neutral-300 font-mono text-xs break-all">{id}</span>
            </div>
            {session && (
              <>
                <div className="flex gap-2">
                  <span className="text-neutral-500 min-w-[80px]">Channel:</span>
                  <span className="text-blue-400 capitalize">{session.channel}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-neutral-500 min-w-[80px]">Created:</span>
                  <span className="text-neutral-300">{formatDate(session.created_at)}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-neutral-500 min-w-[80px]">Last Active:</span>
                  <span className="text-neutral-300">{formatDate(session.last_active_at)}</span>
                </div>
              </>
            )}
          </div>
        </section>
        
        {/* Stream Mode */}
        <section className="bg-[#151515] border border-[#222] rounded-xl p-5 mb-4">
          <h3 className="text-base font-semibold text-white mb-1">Stream Mode</h3>
          <p className="text-xs text-neutral-500 mb-4">How responses are delivered to this session.</p>
          
          <select
            className={selectClass + " max-w-xs"}
            value={config.streamMode || ''}
            onChange={(e) => handleStreamModeChange(e.target.value)}
          >
            <option value="">Channel default</option>
            <option value="stream">Stream — token by token</option>
            <option value="final">Final only — wait for complete response</option>
            <option value="bundled">Bundled — chunked updates</option>
          </select>
        </section>
        
        {/* Harness Selection */}
        <section className="bg-[#151515] border border-[#222] rounded-xl p-5 mb-4">
          <h3 className="text-base font-semibold text-white mb-1">Harness</h3>
          <p className="text-xs text-neutral-500 mb-4">Which AI harness to use for this session.</p>
          
          <select
            className={selectClass + " max-w-xs"}
            value={config.harness || ''}
            onChange={(e) => handleHarnessChange(e.target.value)}
          >
            <option value="">Global default ({globalDefault})</option>
            {availableHarnesses.map(h => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </section>
        
        {/* Model Override (pi-coding-agent specific) */}
        {selectedHarness === 'pi-coding-agent' && (
          <section className="bg-[#151515] border border-[#222] rounded-xl p-5 mb-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-semibold text-white">Model Override</h3>
              {effectiveModel?.provider && (
                <button
                  onClick={clearModelOverride}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Clear Override
                </button>
              )}
            </div>
            <p className="text-xs text-neutral-500 mb-4">
              Override the default model for this session. Leave empty to use the harness default.
            </p>
            
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-neutral-400 mb-1.5">Provider</label>
                <select
                  className={selectClass + " max-w-xs"}
                  value={piConfig.model?.provider || effectiveModel?.provider || ''}
                  onChange={(e) => handleProviderChange(e.target.value)}
                >
                  <option value="">Use harness default</option>
                  {sortedProviders.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              
              {(piConfig.model?.provider || effectiveModel?.provider) && (
                <div>
                  <label className="block text-sm text-neutral-400 mb-1.5">Model</label>
                  {loadingModels ? (
                    <span className="text-xs text-neutral-500">Loading models...</span>
                  ) : (
                    <select
                      className={selectClass + " max-w-xs"}
                      value={piConfig.model?.name || effectiveModel?.name || ''}
                      onChange={(e) => handleModelChange(e.target.value)}
                    >
                      <option value="">Select model...</option>
                      {models.map(m => (
                        <option key={m.id} value={m.id}>{m.id}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              
              {effectiveModel?.provider && effectiveModel?.name && (
                <div className="inline-flex items-center gap-2 bg-blue-950/50 border border-blue-600/30 rounded-lg px-3 py-2 text-sm text-blue-400 font-mono">
                  🤖 {effectiveModel.provider}/{effectiveModel.name}
                </div>
              )}
            </div>
          </section>
        )}
        
        {/* Claude Code Config */}
        {selectedHarness === 'claude-code' && (
          <section className="bg-[#151515] border border-[#222] rounded-xl p-5 mb-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-semibold text-white">Claude Code Settings</h3>
              {(claudeCodeConfig.model || claudeCodeConfig.permissionMode) && (
                <button
                  onClick={() => {
                    const newConfig = { ...config };
                    delete newConfig['claude-code'];
                    setConfig(newConfig);
                    saveConfig(newConfig);
                  }}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Clear Overrides
                </button>
              )}
            </div>
            <p className="text-xs text-neutral-500 mb-4">
              Configure the Claude Code CLI harness.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-neutral-400 mb-1.5">Model</label>
                <select
                  className={selectClass + " max-w-xs"}
                  value={claudeCodeConfig.model || ''}
                  onChange={(e) => {
                    const newConfig = { ...config };
                    if (e.target.value) {
                      newConfig['claude-code'] = { ...claudeCodeConfig, model: e.target.value };
                    } else {
                      if (newConfig['claude-code']) {
                        delete newConfig['claude-code'].model;
                        if (Object.keys(newConfig['claude-code']).length === 0) {
                          delete newConfig['claude-code'];
                        }
                      }
                    }
                    setConfig(newConfig);
                    saveConfig(newConfig);
                  }}
                >
                  <option value="">Default</option>
                  <option value="sonnet">Sonnet</option>
                  <option value="opus">Opus</option>
                  <option value="haiku">Haiku</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm text-neutral-400 mb-1.5">Permission Mode</label>
                <select
                  className={selectClass + " max-w-xs"}
                  value={claudeCodeConfig.permissionMode || ''}
                  onChange={(e) => {
                    const newConfig = { ...config };
                    if (e.target.value) {
                      newConfig['claude-code'] = { ...claudeCodeConfig, permissionMode: e.target.value };
                    } else {
                      if (newConfig['claude-code']) {
                        delete newConfig['claude-code'].permissionMode;
                        if (Object.keys(newConfig['claude-code']).length === 0) {
                          delete newConfig['claude-code'];
                        }
                      }
                    }
                    setConfig(newConfig);
                    saveConfig(newConfig);
                  }}
                >
                  <option value="">Default (bypass permissions)</option>
                  <option value="bypassPermissions">Bypass Permissions ⚠️</option>
                  <option value="acceptEdits">Accept Edits Only</option>
                  <option value="plan">Plan Mode (no execution)</option>
                </select>
                <p className="text-xs text-neutral-600 mt-1">
                  Bypass permissions is required for headless automation.
                </p>
              </div>
              
              {(claudeCodeConfig.model || claudeCodeConfig.permissionMode) && (
                <div className="inline-flex items-center gap-2 bg-purple-950/50 border border-purple-600/30 rounded-lg px-3 py-2 text-sm text-purple-400 font-mono">
                  🔧 claude-code/{claudeCodeConfig.model || 'default'}
                </div>
              )}
            </div>
          </section>
        )}
        
        {/* Reset All */}
        {hasOverrides && (
          <section className="bg-[#151515] border border-[#222] rounded-xl p-5">
            <h3 className="text-base font-semibold text-white mb-1">Reset to Defaults</h3>
            <p className="text-xs text-neutral-500 mb-4">
              Remove all session-specific settings and use global defaults.
            </p>
            <button
              onClick={() => {
                setConfig({});
                saveConfig({});
              }}
              className="px-4 py-2 bg-red-950 hover:bg-red-900 border border-red-800 text-red-300 rounded-md text-sm transition-colors"
            >
              Reset All Settings
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

export default SessionSettings;
