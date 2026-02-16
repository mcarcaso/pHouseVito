import { useState, useEffect } from 'react';

interface HarnessInfo {
  name: string;
  description: string;
  config: any;
  isDefault: boolean;
}

interface SessionOverride {
  id: string;
  harness: string;
  overrides: any;
}

interface HarnessesData {
  default: string;
  available: Record<string, HarnessInfo>;
  sessionOverrides: SessionOverride[];
}

interface ModelOption {
  id: string;
}

interface ProviderKeyInfo {
  envVar: string;
  description: string;
}

interface AuthStatus {
  hasAuth: boolean;
  authType?: 'apiKey' | 'oauth';
  expiresAt?: number;
}

interface ProvidersResponse {
  providers: string[];
  keyStatus: Record<string, boolean>;
  keyInfo: Record<string, ProviderKeyInfo>;
  authStatus?: Record<string, AuthStatus>;
}

// Claude Code specific config
interface ClaudeCodeConfig {
  model?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  allowedTools?: string[];
}

const CLAUDE_CODE_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'LS',
  'NotebookRead',
  'NotebookEdit',
  'WebFetch',
  'TodoRead',
  'TodoWrite',
];

const CLAUDE_CODE_MODELS = [
  { id: 'sonnet', label: 'Claude Sonnet' },
  { id: 'opus', label: 'Claude Opus' },
  { id: 'haiku', label: 'Claude Haiku' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (2025-05-14)' },
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4 (2025-05-14)' },
];

const PERMISSION_MODES = [
  { id: 'bypassPermissions', label: 'Bypass Permissions (dangerous, for automation)' },
  { id: 'acceptEdits', label: 'Accept Edits (auto-accept file changes)' },
  { id: 'default', label: 'Default (prompt for permissions)' },
  { id: 'plan', label: 'Plan Only (no execution)' },
];

const selectClass = "w-full sm:w-64 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-base sm:text-sm focus:outline-none focus:border-blue-600 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23666%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.75rem_center] pr-8";
const inputClass = "w-full sm:w-64 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-base sm:text-sm focus:outline-none focus:border-blue-600 transition-colors";

function Harnesses() {
  const [data, setData] = useState<HarnessesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Pi coding agent editing state
  const [editingPi, setEditingPi] = useState(false);
  const [savingPi, setSavingPi] = useState(false);
  const [savedPi, setSavedPi] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [keyInfo, setKeyInfo] = useState<Record<string, ProviderKeyInfo>>({});
  const [authStatus, setAuthStatus] = useState<Record<string, AuthStatus>>({});
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');

  // Claude Code editing state
  const [editingClaude, setEditingClaude] = useState(false);
  const [savingClaude, setSavingClaude] = useState(false);
  const [savedClaude, setSavedClaude] = useState(false);
  const [claudeModel, setClaudeModel] = useState('sonnet');
  const [claudePermissionMode, setClaudePermissionMode] = useState<string>('bypassPermissions');
  const [claudeAllowedTools, setClaudeAllowedTools] = useState<string[]>([]);
  const [customModel, setCustomModel] = useState('');

  // Default harness state
  const [changingDefault, setChangingDefault] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/harnesses').then(r => r.json()),
      fetch('/api/models/providers').then(r => r.json()) as Promise<ProvidersResponse>,
    ]).then(([harnessData, providerData]) => {
      setData(harnessData);
      setProviders(providerData.providers);
      setKeyInfo(providerData.keyInfo || {});
      setAuthStatus(providerData.authStatus || {});
      
      // Set initial values from current config (Pi)
      const piConfig = harnessData.available['pi-coding-agent']?.config;
      if (piConfig?.model) {
        setSelectedProvider(piConfig.model.provider || '');
        setSelectedModel(piConfig.model.name || '');
        if (piConfig.model.provider) {
          loadModelsForProvider(piConfig.model.provider);
        }
      }

      // Set initial values for Claude Code
      const claudeConfig = harnessData.available['claude-code']?.config;
      if (claudeConfig) {
        setClaudeModel(claudeConfig.model || 'sonnet');
        setClaudePermissionMode(claudeConfig.permissionMode || 'bypassPermissions');
        setClaudeAllowedTools(claudeConfig.allowedTools || []);
      }
      
      setLoading(false);
    }).catch((err) => {
      setError(err.message);
      setLoading(false);
    });
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

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider);
    setSelectedModel('');
    loadModelsForProvider(provider);
  };

  const savePiModel = async () => {
    if (!selectedProvider || !selectedModel) return;
    setSavingPi(true);
    try {
      const configRes = await fetch('/api/config');
      const currentConfig = await configRes.json();
      
      const updatedConfig = {
        ...currentConfig,
        harnesses: {
          ...currentConfig.harnesses,
          'pi-coding-agent': {
            ...currentConfig.harnesses?.['pi-coding-agent'],
            model: { provider: selectedProvider, name: selectedModel },
          },
        },
      };
      
      delete updatedConfig.model;
      
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });
      
      const newData = await fetch('/api/harnesses').then(r => r.json());
      setData(newData);
      
      setSavedPi(true);
      setEditingPi(false);
      setTimeout(() => setSavedPi(false), 2000);
    } catch (err) {
      console.error('Failed to save:', err);
    }
    setSavingPi(false);
  };

  const saveClaudeConfig = async () => {
    setSavingClaude(true);
    try {
      const configRes = await fetch('/api/config');
      const currentConfig = await configRes.json();
      
      const modelToSave = customModel.trim() || claudeModel;
      
      const claudeCodeConfig: ClaudeCodeConfig = {
        model: modelToSave,
        permissionMode: claudePermissionMode as ClaudeCodeConfig['permissionMode'],
      };
      
      // Only include allowedTools if some are selected (empty = all tools allowed)
      if (claudeAllowedTools.length > 0 && claudeAllowedTools.length < CLAUDE_CODE_TOOLS.length) {
        claudeCodeConfig.allowedTools = claudeAllowedTools;
      }
      
      const updatedConfig = {
        ...currentConfig,
        harnesses: {
          ...currentConfig.harnesses,
          'claude-code': claudeCodeConfig,
        },
      };
      
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });
      
      const newData = await fetch('/api/harnesses').then(r => r.json());
      setData(newData);
      
      setSavedClaude(true);
      setEditingClaude(false);
      setCustomModel('');
      setTimeout(() => setSavedClaude(false), 2000);
    } catch (err) {
      console.error('Failed to save:', err);
    }
    setSavingClaude(false);
  };

  const setDefaultHarness = async (harnessName: string) => {
    setChangingDefault(true);
    try {
      const configRes = await fetch('/api/config');
      const currentConfig = await configRes.json();
      
      const updatedConfig = {
        ...currentConfig,
        harnesses: {
          ...currentConfig.harnesses,
          default: harnessName,
        },
      };
      
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });
      
      const newData = await fetch('/api/harnesses').then(r => r.json());
      setData(newData);
    } catch (err) {
      console.error('Failed to set default:', err);
    }
    setChangingDefault(false);
  };

  const toggleTool = (tool: string) => {
    setClaudeAllowedTools(prev => 
      prev.includes(tool) 
        ? prev.filter(t => t !== tool)
        : [...prev, tool]
    );
  };

  const selectAllTools = () => setClaudeAllowedTools([...CLAUDE_CODE_TOOLS]);
  const clearAllTools = () => setClaudeAllowedTools([]);

  if (loading) return <div className="p-4 text-[#888]">Loading...</div>;
  if (error) return <div className="p-4 text-red-400">Error: {error}</div>;
  if (!data) return null;

  const harnesses = Object.values(data.available);
  
  const popularProviders = ['anthropic', 'openai', 'google', 'xai', 'groq', 'mistral', 'openrouter'];
  const availableProviders = providers.filter(p => authStatus[p]?.hasAuth === true);
  const sortedProviders = [
    ...popularProviders.filter(p => availableProviders.includes(p)),
    ...availableProviders.filter(p => !popularProviders.includes(p)).sort(),
  ];

  const getAuthDisplay = (provider: string): string => {
    const status = authStatus[provider];
    if (!status?.hasAuth) return '';
    if (status.authType === 'oauth') return '✓ OAuth';
    return `✓ ${keyInfo[provider]?.envVar || 'API Key'}`;
  };

  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold text-white m-0">Harnesses</h2>
        <span className="text-sm text-[#666]">AI model wrappers</span>
      </div>

      <p className="text-sm text-[#888] mb-6 max-w-xl">
        A harness wraps an AI model and provides a unified interface for the orchestrator.
        Each harness has its own config. Sessions can override which harness to use.
      </p>

      {/* Available Harnesses */}
      <div className="max-w-[700px]">
        {harnesses.map((harness) => (
          <section
            key={harness.name}
            className="bg-[#151515] border border-[#222] rounded-xl p-5 mb-3"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-xl">{harness.name === 'claude-code' ? '🤖' : '🎭'}</span>
                <h3 className="text-base font-semibold text-white">{harness.name}</h3>
                {harness.isDefault && (
                  <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full">
                    default
                  </span>
                )}
                {!harness.isDefault && (
                  <button
                    onClick={() => setDefaultHarness(harness.name)}
                    disabled={changingDefault}
                    className="text-xs text-neutral-500 hover:text-blue-400 transition-colors"
                  >
                    set as default
                  </button>
                )}
              </div>
              
              {/* Edit buttons */}
              {harness.name === 'pi-coding-agent' && !editingPi && (
                <button
                  onClick={() => setEditingPi(true)}
                  className="px-3 py-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Edit
                </button>
              )}
              {harness.name === 'pi-coding-agent' && editingPi && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditingPi(false)}
                    className="px-3 py-1 text-sm text-neutral-400 hover:text-neutral-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={savePiModel}
                    disabled={savingPi || !selectedProvider || !selectedModel}
                    className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-default text-white rounded-md transition-colors"
                  >
                    {savingPi ? 'Saving...' : savedPi ? 'Saved ✓' : 'Save'}
                  </button>
                </div>
              )}
              {harness.name === 'claude-code' && !editingClaude && (
                <button
                  onClick={() => setEditingClaude(true)}
                  className="px-3 py-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Edit
                </button>
              )}
              {harness.name === 'claude-code' && editingClaude && (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditingClaude(false);
                      setCustomModel('');
                      // Reset to current config
                      const claudeConfig = data.available['claude-code']?.config;
                      if (claudeConfig) {
                        setClaudeModel(claudeConfig.model || 'sonnet');
                        setClaudePermissionMode(claudeConfig.permissionMode || 'bypassPermissions');
                        setClaudeAllowedTools(claudeConfig.allowedTools || []);
                      }
                    }}
                    className="px-3 py-1 text-sm text-neutral-400 hover:text-neutral-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveClaudeConfig}
                    disabled={savingClaude}
                    className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-default text-white rounded-md transition-colors"
                  >
                    {savingClaude ? 'Saving...' : savedClaude ? 'Saved ✓' : 'Save'}
                  </button>
                </div>
              )}
            </div>

            <p className="text-sm text-[#888] mb-4">{harness.description}</p>

            {/* ═══════════════════════════════════════════════════════════════════
                PI CODING AGENT CONFIG
            ═══════════════════════════════════════════════════════════════════ */}
            
            {harness.name === 'pi-coding-agent' && harness.config && !editingPi && (
              <div className="border-t border-[#1a1a1a] pt-4">
                <h4 className="text-sm text-[#666] mb-3">Configuration</h4>
                <div className="bg-[#111] border border-[#222] rounded-md p-3 font-mono text-sm">
                  {harness.config.model && (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[#666]">Model:</span>
                      <span className="text-[#8b8bcc]">
                        {harness.config.model.provider}/{harness.config.model.name}
                      </span>
                    </div>
                  )}
                  {harness.config.thinkingLevel && (
                    <div className="flex items-center gap-2">
                      <span className="text-[#666]">Thinking:</span>
                      <span className="text-[#8b8bcc]">{harness.config.thinkingLevel}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {harness.name === 'pi-coding-agent' && editingPi && (
              <div className="border-t border-[#1a1a1a] pt-4">
                <h4 className="text-sm text-[#666] mb-3">Configuration</h4>
                
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <label className="text-sm text-neutral-400 sm:w-24 sm:shrink-0">Provider</label>
                    {sortedProviders.length === 0 ? (
                      <span className="text-xs text-red-400">
                        No API keys configured. Add provider keys in <a href="/secrets" className="text-blue-400 underline">Secrets</a>.
                      </span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <select
                          className={selectClass}
                          value={selectedProvider}
                          onChange={(e) => handleProviderChange(e.target.value)}
                        >
                          <option value="">Select provider...</option>
                          {sortedProviders.map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                        {selectedProvider && authStatus[selectedProvider]?.hasAuth && (
                          <span className="text-xs text-green-400">{getAuthDisplay(selectedProvider)}</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <label className="text-sm text-neutral-400 sm:w-24 sm:shrink-0">Model</label>
                    {loadingModels ? (
                      <span className="text-xs text-neutral-600">Loading models...</span>
                    ) : (
                      <select
                        className={selectClass}
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                      >
                        <option value="">Select model...</option>
                        {models.map(m => (
                          <option key={m.id} value={m.id}>{m.id}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {selectedProvider && selectedModel && (
                  <div className="inline-flex items-center gap-2 bg-blue-950/50 border border-blue-600/30 rounded-lg px-3 py-2 mt-4 text-sm text-blue-400 font-mono">
                    🤖 {selectedProvider}/{selectedModel}
                  </div>
                )}
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════════
                CLAUDE CODE CONFIG
            ═══════════════════════════════════════════════════════════════════ */}
            
            {harness.name === 'claude-code' && harness.config && !editingClaude && (
              <div className="border-t border-[#1a1a1a] pt-4">
                <h4 className="text-sm text-[#666] mb-3">Configuration</h4>
                <div className="bg-[#111] border border-[#222] rounded-md p-3 font-mono text-sm space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[#666]">Model:</span>
                    <span className="text-[#8b8bcc]">{harness.config.model || 'sonnet'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#666]">Permission Mode:</span>
                    <span className="text-[#8b8bcc]">{harness.config.permissionMode || 'bypassPermissions'}</span>
                  </div>
                  {harness.config.allowedTools && harness.config.allowedTools.length > 0 && (
                    <div className="flex items-start gap-2">
                      <span className="text-[#666]">Tools:</span>
                      <span className="text-[#8b8bcc]">{harness.config.allowedTools.join(', ')}</span>
                    </div>
                  )}
                  {(!harness.config.allowedTools || harness.config.allowedTools.length === 0) && (
                    <div className="flex items-center gap-2">
                      <span className="text-[#666]">Tools:</span>
                      <span className="text-[#8b8bcc]">All tools enabled</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {harness.name === 'claude-code' && editingClaude && (
              <div className="border-t border-[#1a1a1a] pt-4">
                <h4 className="text-sm text-[#666] mb-3">Configuration</h4>
                
                <div className="space-y-4">
                  {/* Model Selection */}
                  <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                    <label className="text-sm text-neutral-400 sm:w-32 sm:shrink-0 pt-2">Model</label>
                    <div className="flex flex-col gap-2 flex-1">
                      <select
                        className={selectClass}
                        value={customModel ? '' : claudeModel}
                        onChange={(e) => {
                          setClaudeModel(e.target.value);
                          setCustomModel('');
                        }}
                      >
                        {CLAUDE_CODE_MODELS.map(m => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </select>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-neutral-500">or custom:</span>
                        <input
                          type="text"
                          className={inputClass + " flex-1"}
                          placeholder="e.g., claude-3-5-sonnet-20241022"
                          value={customModel}
                          onChange={(e) => setCustomModel(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Permission Mode */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <label className="text-sm text-neutral-400 sm:w-32 sm:shrink-0">Permission Mode</label>
                    <select
                      className={selectClass}
                      value={claudePermissionMode}
                      onChange={(e) => setClaudePermissionMode(e.target.value)}
                    >
                      {PERMISSION_MODES.map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Allowed Tools */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-4">
                      <label className="text-sm text-neutral-400 sm:w-32 sm:shrink-0">Allowed Tools</label>
                      <div className="flex gap-2">
                        <button
                          onClick={selectAllTools}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          Select All
                        </button>
                        <span className="text-neutral-600">|</span>
                        <button
                          onClick={clearAllTools}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          Clear All
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-neutral-500 ml-0 sm:ml-36">
                      Leave empty to allow all tools. Select specific tools to restrict access.
                    </p>
                    <div className="flex flex-wrap gap-2 ml-0 sm:ml-36 mt-1">
                      {CLAUDE_CODE_TOOLS.map(tool => (
                        <button
                          key={tool}
                          onClick={() => toggleTool(tool)}
                          className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                            claudeAllowedTools.includes(tool)
                              ? 'bg-blue-900 border-blue-600 text-blue-300'
                              : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:border-neutral-500'
                          }`}
                        >
                          {tool}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Preview */}
                <div className="mt-4 p-3 bg-[#0a0a0a] border border-[#222] rounded-md">
                  <div className="text-xs text-neutral-500 mb-2">Preview</div>
                  <div className="font-mono text-sm text-[#8b8bcc]">
                    claude --model {customModel || claudeModel}
                    {claudePermissionMode === 'bypassPermissions' && ' --dangerously-skip-permissions'}
                    {claudePermissionMode !== 'bypassPermissions' && claudePermissionMode !== 'default' && ` --permission-mode ${claudePermissionMode}`}
                    {claudeAllowedTools.length > 0 && claudeAllowedTools.length < CLAUDE_CODE_TOOLS.length && ` --tools ${claudeAllowedTools.join(',')}`}
                  </div>
                </div>
              </div>
            )}
          </section>
        ))}

        {/* Session Overrides */}
        {data.sessionOverrides.length > 0 && (
          <section className="bg-[#151515] border border-[#222] rounded-xl p-5 mt-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xl">🔀</span>
              <h3 className="text-base font-semibold text-white">Session Overrides</h3>
              <span className="text-xs bg-[#2a2a2a] text-[#888] px-2 py-0.5 rounded-full">
                {data.sessionOverrides.length}
              </span>
            </div>

            <p className="text-sm text-[#888] mb-4">
              These sessions have custom harness or model settings.
            </p>

            <div className="space-y-2">
              {data.sessionOverrides.map((session) => (
                <div
                  key={session.id}
                  className="bg-[#111] border border-[#222] rounded-md p-3 font-mono text-sm"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[#666]">Session:</span>
                    <span className="text-[#e0e0e0]">{session.id}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#666]">Harness:</span>
                    <span className="text-[#8b8bcc]">{session.harness}</span>
                    {session.overrides?.model && (
                      <>
                        <span className="text-[#444]">→</span>
                        <span className="text-[#8b8bcc]">
                          {session.overrides.model.provider}/{session.overrides.model.name}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default Harnesses;
