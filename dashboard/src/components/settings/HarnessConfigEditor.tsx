import { useState, useEffect } from 'react';
import type { VitoConfig } from '../../utils/settingsResolution';

interface HarnessConfigEditorProps {
  config: VitoConfig;
  onSave: (updates: Partial<VitoConfig>) => Promise<void>;
}

interface ModelOption {
  id: string;
}

interface AuthStatus {
  hasAuth: boolean;
  authType?: 'apiKey' | 'oauth';
  expiresAt?: number;
}

interface ProviderKeyInfo {
  envVar: string;
  description: string;
}

const CLAUDE_CODE_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
  'LS', 'NotebookRead', 'NotebookEdit', 'WebFetch',
  'TodoRead', 'TodoWrite',
];

const CLAUDE_CODE_MODELS = [
  { id: 'sonnet', label: 'Claude Sonnet' },
  { id: 'opus', label: 'Claude Opus' },
  { id: 'haiku', label: 'Claude Haiku' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4 (2025-05-14)' },
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4 (2025-05-14)' },
];

const PERMISSION_MODES = [
  { id: 'bypassPermissions', label: 'Bypass Permissions (automation)' },
  { id: 'acceptEdits', label: 'Accept Edits (auto-accept file changes)' },
  { id: 'default', label: 'Default (prompt for permissions)' },
  { id: 'plan', label: 'Plan Only (no execution)' },
];

const THINKING_LEVELS = [
  { id: 'off', label: 'Off' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

const selectClass = "w-full sm:w-64 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-sm focus:outline-none focus:border-blue-600 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23666%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.75rem_center] pr-8";
const inputClass = "w-full sm:w-64 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-sm focus:outline-none focus:border-blue-600 transition-colors";

export default function HarnessConfigEditor({ config, onSave }: HarnessConfigEditorProps) {
  // Pi state
  const [editingPi, setEditingPi] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [keyInfo, setKeyInfo] = useState<Record<string, ProviderKeyInfo>>({});
  const [authStatus, setAuthStatus] = useState<Record<string, AuthStatus>>({});
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [savingPi, setSavingPi] = useState(false);

  // Claude Code state
  const [editingClaude, setEditingClaude] = useState(false);
  const [claudeModel, setClaudeModel] = useState('sonnet');
  const [claudePermissionMode, setClaudePermissionMode] = useState('bypassPermissions');
  const [claudeAllowedTools, setClaudeAllowedTools] = useState<string[]>([]);
  const [customModel, setCustomModel] = useState('');
  const [savingClaude, setSavingClaude] = useState(false);

  useEffect(() => {
    fetch('/api/models/providers')
      .then((r) => r.json())
      .then((data) => {
        setProviders(data.providers || []);
        setKeyInfo(data.keyInfo || {});
        setAuthStatus(data.authStatus || {});
      })
      .catch(console.error);
  }, []);

  // Sync from config
  useEffect(() => {
    const piConfig = config.harnesses?.['pi-coding-agent'];
    if (piConfig?.model) {
      setSelectedProvider(piConfig.model.provider || '');
      setSelectedModel(piConfig.model.name || '');
      if (piConfig.model.provider) loadModelsForProvider(piConfig.model.provider);
    }
    const cc = config.harnesses?.['claude-code'];
    if (cc) {
      setClaudeModel(cc.model || 'sonnet');
      setClaudePermissionMode(cc.permissionMode || 'bypassPermissions');
      setClaudeAllowedTools(cc.allowedTools || []);
    }
  }, [config]);

  const loadModelsForProvider = async (provider: string) => {
    setLoadingModels(true);
    try {
      const res = await fetch(`/api/models/${provider}`);
      setModels(await res.json());
    } catch {
      setModels([]);
    }
    setLoadingModels(false);
  };

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider);
    setSelectedModel('');
    loadModelsForProvider(provider);
  };

  const savePi = async () => {
    if (!selectedProvider || !selectedModel) return;
    setSavingPi(true);
    const piConfig: any = {
      ...config.harnesses?.['pi-coding-agent'],
      model: { provider: selectedProvider, name: selectedModel },
    };
    await onSave({ harnesses: { ...config.harnesses, 'pi-coding-agent': piConfig } });
    setEditingPi(false);
    setSavingPi(false);
  };

  const saveClaude = async () => {
    setSavingClaude(true);
    const modelToSave = customModel.trim() || claudeModel;
    const ccConfig: any = {
      model: modelToSave,
      permissionMode: claudePermissionMode,
    };
    if (claudeAllowedTools.length > 0 && claudeAllowedTools.length < CLAUDE_CODE_TOOLS.length) {
      ccConfig.allowedTools = claudeAllowedTools;
    }
    await onSave({ harnesses: { ...config.harnesses, 'claude-code': ccConfig } });
    setEditingClaude(false);
    setCustomModel('');
    setSavingClaude(false);
  };

  const toggleTool = (tool: string) =>
    setClaudeAllowedTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
    );

  const popularProviders = ['anthropic', 'openai', 'google', 'xai', 'groq', 'mistral', 'openrouter'];
  const availableProviders = providers.filter((p) => authStatus[p]?.hasAuth === true);
  const sortedProviders = [
    ...popularProviders.filter((p) => availableProviders.includes(p)),
    ...availableProviders.filter((p) => !popularProviders.includes(p)).sort(),
  ];

  const getAuthDisplay = (provider: string): string => {
    const status = authStatus[provider];
    if (!status?.hasAuth) return '';
    if (status.authType === 'oauth') return '\u2713 OAuth';
    return `\u2713 ${keyInfo[provider]?.envVar || 'API Key'}`;
  };

  const piConfig = config.harnesses?.['pi-coding-agent'];
  const ccConfig = config.harnesses?.['claude-code'];

  return (
    <div className="space-y-3">
      {/* ── Pi Coding Agent ── */}
      <section className="bg-[#151515] border border-neutral-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="text-xl">🎭</span>
            <h4 className="text-sm font-semibold text-white">pi-coding-agent</h4>
          </div>
          {!editingPi ? (
            <button onClick={() => setEditingPi(true)} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
              Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditingPi(false)} className="text-xs text-neutral-400 hover:text-neutral-300">Cancel</button>
              <button
                onClick={savePi}
                disabled={savingPi || !selectedProvider || !selectedModel}
                className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md transition-colors"
              >
                {savingPi ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {!editingPi && piConfig ? (
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-md p-3 font-mono text-sm space-y-1">
            {piConfig.model && (
              <div className="flex gap-2">
                <span className="text-neutral-500">Model:</span>
                <span className="text-purple-400">{piConfig.model.provider}/{piConfig.model.name}</span>
              </div>
            )}
            {piConfig.thinkingLevel && (
              <div className="flex gap-2">
                <span className="text-neutral-500">Thinking:</span>
                <span className="text-purple-400">{piConfig.thinkingLevel}</span>
              </div>
            )}
          </div>
        ) : editingPi ? (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-neutral-400 sm:w-24 shrink-0">Provider</label>
              {sortedProviders.length === 0 ? (
                <span className="text-xs text-red-400">No API keys configured. Add keys in <a href="/secrets" className="text-blue-400 underline">Secrets</a>.</span>
              ) : (
                <div className="flex flex-col gap-1">
                  <select className={selectClass} value={selectedProvider} onChange={(e) => handleProviderChange(e.target.value)}>
                    <option value="">Select provider...</option>
                    {sortedProviders.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  {selectedProvider && authStatus[selectedProvider]?.hasAuth && (
                    <span className="text-xs text-green-400">{getAuthDisplay(selectedProvider)}</span>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-neutral-400 sm:w-24 shrink-0">Model</label>
              {loadingModels ? (
                <span className="text-xs text-neutral-600">Loading models...</span>
              ) : (
                <select className={selectClass} value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                  <option value="">Select model...</option>
                  {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                </select>
              )}
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-neutral-400 sm:w-24 shrink-0">Thinking</label>
              <select className={selectClass} value={piConfig?.thinkingLevel || 'off'} onChange={() => {}}>
                {THINKING_LEVELS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
          </div>
        ) : null}
      </section>

      {/* ── Claude Code ── */}
      <section className="bg-[#151515] border border-neutral-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="text-xl">🤖</span>
            <h4 className="text-sm font-semibold text-white">claude-code</h4>
          </div>
          {!editingClaude ? (
            <button onClick={() => setEditingClaude(true)} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
              Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEditingClaude(false);
                  setCustomModel('');
                  if (ccConfig) {
                    setClaudeModel(ccConfig.model || 'sonnet');
                    setClaudePermissionMode(ccConfig.permissionMode || 'bypassPermissions');
                    setClaudeAllowedTools(ccConfig.allowedTools || []);
                  }
                }}
                className="text-xs text-neutral-400 hover:text-neutral-300"
              >
                Cancel
              </button>
              <button
                onClick={saveClaude}
                disabled={savingClaude}
                className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md transition-colors"
              >
                {savingClaude ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {!editingClaude && ccConfig ? (
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-md p-3 font-mono text-sm space-y-1">
            <div className="flex gap-2">
              <span className="text-neutral-500">Model:</span>
              <span className="text-purple-400">{ccConfig.model || 'sonnet'}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-neutral-500">Permission Mode:</span>
              <span className="text-purple-400">{ccConfig.permissionMode || 'bypassPermissions'}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-neutral-500">Tools:</span>
              <span className="text-purple-400">
                {ccConfig.allowedTools && ccConfig.allowedTools.length > 0
                  ? ccConfig.allowedTools.join(', ')
                  : 'All tools enabled'}
              </span>
            </div>
          </div>
        ) : editingClaude ? (
          <div className="space-y-4">
            {/* Model */}
            <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
              <label className="text-sm text-neutral-400 sm:w-32 shrink-0 pt-2">Model</label>
              <div className="flex flex-col gap-2 flex-1">
                <select
                  className={selectClass}
                  value={customModel ? '' : claudeModel}
                  onChange={(e) => { setClaudeModel(e.target.value); setCustomModel(''); }}
                >
                  {CLAUDE_CODE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500">or custom:</span>
                  <input
                    type="text"
                    className={inputClass + ' flex-1'}
                    placeholder="e.g., claude-3-5-sonnet-20241022"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Permission Mode */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-neutral-400 sm:w-32 shrink-0">Permission Mode</label>
              <select className={selectClass} value={claudePermissionMode} onChange={(e) => setClaudePermissionMode(e.target.value)}>
                {PERMISSION_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>

            {/* Allowed Tools */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-4">
                <label className="text-sm text-neutral-400 sm:w-32 shrink-0">Allowed Tools</label>
                <div className="flex gap-2">
                  <button onClick={() => setClaudeAllowedTools([...CLAUDE_CODE_TOOLS])} className="text-xs text-blue-400 hover:text-blue-300">Select All</button>
                  <span className="text-neutral-600">|</span>
                  <button onClick={() => setClaudeAllowedTools([])} className="text-xs text-blue-400 hover:text-blue-300">Clear All</button>
                </div>
              </div>
              <p className="text-xs text-neutral-500 sm:ml-36">Leave empty to allow all tools.</p>
              <div className="flex flex-wrap gap-2 sm:ml-36 mt-1">
                {CLAUDE_CODE_TOOLS.map((tool) => (
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

            {/* Preview */}
            <div className="p-3 bg-neutral-950 border border-neutral-800 rounded-md">
              <div className="text-xs text-neutral-500 mb-1">Preview</div>
              <div className="font-mono text-sm text-purple-400">
                claude --model {customModel || claudeModel}
                {claudePermissionMode === 'bypassPermissions' && ' --dangerously-skip-permissions'}
                {claudePermissionMode !== 'bypassPermissions' && claudePermissionMode !== 'default' && ` --permission-mode ${claudePermissionMode}`}
                {claudeAllowedTools.length > 0 && claudeAllowedTools.length < CLAUDE_CODE_TOOLS.length && ` --tools ${claudeAllowedTools.join(',')}`}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
