import { useState, useEffect, useRef, useCallback } from 'react';
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

interface OAuthProviderInfo {
  id: string;
  name: string;
}

const THINKING_LEVELS = [
  { id: 'off', label: 'Off' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

// Claude Code --model values, grouped by category. Aliases auto-track the
// latest version; pinned IDs lock to a specific version for reproducibility.
// Update this list when Anthropic ships new Claude models.
const CC_MODEL_OPTIONS: { group: string; items: { value: string; label: string }[] }[] = [
  {
    group: 'Aliases (auto-update)',
    items: [
      { value: 'opus', label: 'opus — latest Opus' },
      { value: 'sonnet', label: 'sonnet — latest Sonnet' },
      { value: 'haiku', label: 'haiku — latest Haiku' },
      { value: 'opusplan', label: 'opusplan — Opus for planning, Sonnet for execution' },
    ],
  },
  {
    group: 'Pinned versions',
    items: [
      { value: 'claude-opus-4-7', label: 'claude-opus-4-7 — Opus 4.7 (Apr 2026)' },
      { value: 'claude-opus-4-6', label: 'claude-opus-4-6 — Opus 4.6 (Feb 2026)' },
      { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6 — Sonnet 4.6 (Feb 2026)' },
      { value: 'claude-haiku-4-5', label: 'claude-haiku-4-5 — Haiku 4.5 (Oct 2025)' },
    ],
  },
];

const ALL_CC_MODEL_VALUES = CC_MODEL_OPTIONS.flatMap((g) => g.items.map((i) => i.value));

const CC_PERMISSION_MODES = [
  { id: 'default', label: 'Default' },
  { id: 'acceptEdits', label: 'Accept Edits' },
  { id: 'bypassPermissions', label: 'Bypass Permissions' },
  { id: 'plan', label: 'Plan' },
];

const selectClass = "w-full sm:w-64 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-sm focus:outline-none focus:border-blue-600 transition-colors cursor-pointer appearance-none bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23666%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_0.75rem_center] pr-8";

export default function HarnessConfigEditor({ config, onSave }: HarnessConfigEditorProps) {
  // Pi state
  const [editingPi, setEditingPi] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [keyInfo, setKeyInfo] = useState<Record<string, ProviderKeyInfo>>({});
  const [authStatus, setAuthStatus] = useState<Record<string, AuthStatus>>({});
  const [oauthProviders, setOauthProviders] = useState<OAuthProviderInfo[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedThinking, setSelectedThinking] = useState('off');
  const [savingPi, setSavingPi] = useState(false);

  // Claude Code state
  const [editingCC, setEditingCC] = useState(false);
  const [ccModel, setCcModel] = useState('');
  const [ccPermissionMode, setCcPermissionMode] = useState<'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'>('bypassPermissions');
  const [ccBinaryPath, setCcBinaryPath] = useState('');
  const [savingCC, setSavingCC] = useState(false);

  // OAuth login state
  const [loggingIn, setLoggingIn] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [deviceLogin, setDeviceLogin] = useState<{ providerId: string; userCode: string; verificationUri: string; expiresInSeconds?: number } | null>(null);
  const [promptLogin, setPromptLogin] = useState<{ providerId: string; message?: string } | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const loginPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshProviders = useCallback(() => {
    return fetch('/api/models/providers')
      .then((r) => r.json())
      .then((data) => {
        setProviders(data.providers || []);
        setKeyInfo(data.keyInfo || {});
        setAuthStatus(data.authStatus || {});
        setOauthProviders(data.oauthProviders || []);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    refreshProviders();
  }, [refreshProviders]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (loginPollRef.current) clearInterval(loginPollRef.current);
    };
  }, []);

  // Sync from config
  useEffect(() => {
    const piConfig = config.harnesses?.['pi-coding-agent'];
    if (piConfig?.model) {
      setSelectedProvider(piConfig.model.provider || '');
      setSelectedModel(piConfig.model.name || '');
      if (piConfig.model.provider) loadModelsForProvider(piConfig.model.provider);
    }
    if (piConfig?.thinkingLevel) {
      setSelectedThinking(piConfig.thinkingLevel);
    }

    const ccConfig = config.harnesses?.['claude-code'];
    if (ccConfig?.model?.name) setCcModel(ccConfig.model.name);
    if (ccConfig?.permissionMode) setCcPermissionMode(ccConfig.permissionMode);
    if (ccConfig?.binaryPath) setCcBinaryPath(ccConfig.binaryPath);
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

  const handleOAuthLogin = async (providerId: string) => {
    setLoggingIn(providerId);
    setLoginError(null);
    setDeviceLogin(null);
    setPromptLogin(null);
    setPromptValue('');
    try {
      const res = await fetch(`/api/auth/provider/${providerId}/login`, { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        setLoginError(data.error);
        setLoggingIn(null);
        return;
      }
      if (data.status === 'already_authenticated') {
        setLoggingIn(null);
        refreshProviders();
        return;
      }
      // Open browser OAuth URLs, or show a device code for remote-dashboard-safe auth.
      if (data.url) {
        window.open(data.url, '_blank');
      }
      if (data.status === 'device_code_started') {
        setDeviceLogin({
          providerId,
          userCode: data.userCode,
          verificationUri: data.verificationUri,
          expiresInSeconds: data.expiresInSeconds,
        });
        window.open(data.verificationUri, '_blank');
      }
      // Poll for login completion
      loginPollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/auth/provider/${providerId}/login/status`);
          const statusData = await statusRes.json();
          if (statusData.status === 'success') {
            if (loginPollRef.current) clearInterval(loginPollRef.current);
            loginPollRef.current = null;
            setLoggingIn(null);
            setDeviceLogin(null);
            setPromptLogin(null);
            refreshProviders();
          } else if (statusData.status === 'prompt') {
            setPromptLogin({ providerId, message: statusData.promptMessage });
          } else if (statusData.status === 'error') {
            if (loginPollRef.current) clearInterval(loginPollRef.current);
            loginPollRef.current = null;
            setLoginError(statusData.error || 'Login failed');
            setLoggingIn(null);
            setDeviceLogin(null);
            setPromptLogin(null);
          }
        } catch {
          // Ignore poll errors
        }
      }, 2000);
    } catch (err: any) {
      setLoginError(err.message || 'Login request failed');
      setLoggingIn(null);
    }
  };

  const submitOAuthPrompt = async (providerId: string) => {
    setLoginError(null);
    try {
      const res = await fetch(`/api/auth/provider/${providerId}/login/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: promptValue }),
      });
      const data = await res.json();
      if (data.error) {
        setLoginError(data.error);
        return;
      }
      setPromptLogin(null);
      setPromptValue('');
    } catch (err: any) {
      setLoginError(err.message || 'Failed to submit login response');
    }
  };

  const handleOAuthLogout = async (providerId: string) => {
    try {
      await fetch(`/api/auth/provider/${providerId}/logout`, { method: 'POST' });
      refreshProviders();
    } catch (err: any) {
      console.error('Logout failed:', err);
    }
  };

  const savePi = async () => {
    if (!selectedProvider || !selectedModel) return;
    setSavingPi(true);
    const piConfig: any = {
      ...config.harnesses?.['pi-coding-agent'],
      model: { provider: selectedProvider, name: selectedModel },
      thinkingLevel: selectedThinking,
    };
    await onSave({ harnesses: { ...config.harnesses, 'pi-coding-agent': piConfig } });
    setEditingPi(false);
    setSavingPi(false);
  };

  const saveCC = async () => {
    if (!ccModel.trim()) return;
    setSavingCC(true);
    // Always persist as { provider, name } object — never a bare string. The
    // provider field is informational for CC (it routes via its own auth),
    // but the object shape is required by the harness and the rest of v2.
    const ccConfig: any = {
      ...config.harnesses?.['claude-code'],
      model: { provider: 'anthropic', name: ccModel.trim() },
      permissionMode: ccPermissionMode,
    };
    if (ccBinaryPath.trim()) {
      ccConfig.binaryPath = ccBinaryPath.trim();
    } else {
      delete ccConfig.binaryPath;
    }
    await onSave({ harnesses: { ...config.harnesses, 'claude-code': ccConfig } });
    setEditingCC(false);
    setSavingCC(false);
  };

  // Show providers that have auth OR that support OAuth login (so user can log in)
  const popularProviders = ['anthropic', 'openai', 'openai-codex', 'google', 'xai', 'groq', 'mistral', 'openrouter'];
  const availableProviders = providers.filter((p) => authStatus[p]?.hasAuth === true);
  // Also include OAuth-capable providers that aren't yet authenticated
  const oauthProviderIds = new Set(oauthProviders.map(p => p.id));
  const allCandidates = new Set([...availableProviders, ...providers.filter(p => oauthProviderIds.has(p))]);
  const sortedProviders = [
    ...popularProviders.filter((p) => allCandidates.has(p)),
    ...Array.from(allCandidates).filter((p) => !popularProviders.includes(p)).sort(),
  ];

  const getOAuthProviderName = (providerId: string): string | null => {
    const op = oauthProviders.find(p => p.id === providerId);
    return op?.name || null;
  };

  const getAuthDisplay = (provider: string): string => {
    const status = authStatus[provider];
    if (!status?.hasAuth) return '';
    if (status.authType === 'oauth') {
      const name = getOAuthProviderName(provider);
      return name ? `\u2713 ${name}` : '\u2713 Subscription';
    }
    return `\u2713 ${keyInfo[provider]?.envVar || 'API Key'}`;
  };

  const piConfig = config.harnesses?.['pi-coding-agent'];

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
                <span className="text-xs text-red-400">No API keys configured. Add keys in <a href="/secrets" className="text-blue-400 underline">Secrets</a> or log in with a subscription below.</span>
              ) : (
                <div className="flex flex-col gap-1">
                  <select className={selectClass} value={selectedProvider} onChange={(e) => handleProviderChange(e.target.value)}>
                    <option value="">Select provider...</option>
                    {sortedProviders.map((p) => (
                      <option key={p} value={p}>
                        {p}{authStatus[p]?.hasAuth ? '' : ' (not authenticated)'}
                      </option>
                    ))}
                  </select>
                  {selectedProvider && authStatus[selectedProvider]?.hasAuth && (
                    <span className="text-xs text-green-400">{getAuthDisplay(selectedProvider)}</span>
                  )}
                  {/* Show OAuth login/logout for selected provider */}
                  {selectedProvider && oauthProviderIds.has(selectedProvider) && (
                    <div className="flex items-center gap-2 mt-1">
                      {authStatus[selectedProvider]?.authType === 'oauth' ? (
                        <button
                          onClick={() => handleOAuthLogout(selectedProvider)}
                          className="text-xs text-red-400 hover:text-red-300 transition-colors"
                        >
                          Log out of {getOAuthProviderName(selectedProvider) || 'subscription'}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleOAuthLogin(selectedProvider)}
                          disabled={loggingIn === selectedProvider}
                          className="text-xs text-blue-400 hover:text-blue-300 disabled:text-neutral-500 transition-colors"
                        >
                          {loggingIn === selectedProvider
                            ? 'Waiting for login...'
                            : `Log in with ${getOAuthProviderName(selectedProvider) || 'subscription'}`}
                        </button>
                      )}
                    </div>
                  )}
                  {deviceLogin && deviceLogin.providerId === selectedProvider && (
                    <div className="mt-2 max-w-md rounded-md border border-blue-900/60 bg-blue-950/30 p-3 text-xs text-neutral-200 space-y-2">
                      <div>Enter this code at <a href={deviceLogin.verificationUri} target="_blank" rel="noreferrer" className="text-blue-300 underline">{deviceLogin.verificationUri}</a>:</div>
                      <div className="font-mono text-lg tracking-widest text-white">{deviceLogin.userCode}</div>
                      {deviceLogin.expiresInSeconds && <div className="text-neutral-400">Expires in about {Math.round(deviceLogin.expiresInSeconds / 60)} minutes.</div>}
                    </div>
                  )}
                  {promptLogin && promptLogin.providerId === selectedProvider && (
                    <div className="mt-2 max-w-md rounded-md border border-amber-900/60 bg-amber-950/20 p-3 text-xs text-neutral-200 space-y-2">
                      <div>{promptLogin.message || 'After the browser redirects to localhost, copy the full redirected URL and paste it here:'}</div>
                      <input
                        value={promptValue}
                        onChange={(e) => setPromptValue(e.target.value)}
                        placeholder="http://localhost:..."
                        className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-2 py-1.5 text-neutral-200 focus:outline-none focus:border-amber-600"
                      />
                      <button
                        onClick={() => submitOAuthPrompt(selectedProvider)}
                        disabled={!promptValue.trim()}
                        className="px-3 py-1 text-xs bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-md transition-colors"
                      >
                        Submit redirect URL
                      </button>
                    </div>
                  )}
                  {loginError && (loggingIn === null || promptLogin) && (
                    <span className="text-xs text-red-400 mt-1">{loginError}</span>
                  )}
                </div>
              )}
            </div>
            {/* OAuth login buttons for providers not yet authenticated */}
            {sortedProviders.length === 0 && oauthProviders.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs text-neutral-400">Or log in with a subscription:</span>
                {oauthProviders
                  .filter(op => providers.includes(op.id))
                  .map(op => (
                    <button
                      key={op.id}
                      onClick={() => handleOAuthLogin(op.id)}
                      disabled={loggingIn === op.id}
                      className="block text-xs text-blue-400 hover:text-blue-300 disabled:text-neutral-500 transition-colors"
                    >
                      {loggingIn === op.id ? 'Waiting for login...' : `Log in with ${op.name}`}
                    </button>
                  ))}
              </div>
            )}
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
              <select className={selectClass} value={selectedThinking} onChange={(e) => setSelectedThinking(e.target.value)}>
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
          {!editingCC ? (
            <button onClick={() => setEditingCC(true)} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
              Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditingCC(false)} className="text-xs text-neutral-400 hover:text-neutral-300">Cancel</button>
              <button
                onClick={saveCC}
                disabled={savingCC || !ccModel.trim()}
                className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md transition-colors"
              >
                {savingCC ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {!editingCC ? (
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-md p-3 font-mono text-sm space-y-1">
            <div className="flex gap-2">
              <span className="text-neutral-500">Model:</span>
              <span className="text-purple-400">
                {config.harnesses?.['claude-code']?.model?.name || <span className="text-neutral-600 italic">default</span>}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="text-neutral-500">Permission:</span>
              <span className="text-purple-400">
                {config.harnesses?.['claude-code']?.permissionMode || 'bypassPermissions'}
              </span>
            </div>
            {config.harnesses?.['claude-code']?.binaryPath && (
              <div className="flex gap-2">
                <span className="text-neutral-500">Binary:</span>
                <span className="text-purple-400">{config.harnesses['claude-code'].binaryPath}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-neutral-400 sm:w-24 shrink-0">Model</label>
              <div className="flex flex-col gap-1 flex-1">
                <select
                  className={selectClass}
                  value={ccModel}
                  onChange={(e) => setCcModel(e.target.value)}
                >
                  <option value="">Select a model...</option>
                  {/* If the saved model isn't in our known list, surface it so the
                      dropdown can still display it (e.g. custom or legacy value). */}
                  {ccModel && !ALL_CC_MODEL_VALUES.includes(ccModel) && (
                    <option value={ccModel}>{ccModel} (current)</option>
                  )}
                  {CC_MODEL_OPTIONS.map((group) => (
                    <optgroup key={group.group} label={group.group}>
                      {group.items.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <span className="text-xs text-neutral-600">
                  Passed to <code className="text-neutral-500">claude --model</code>. CC handles auth and routing.
                </span>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-neutral-400 sm:w-24 shrink-0">Permission</label>
              <select
                className={selectClass}
                value={ccPermissionMode}
                onChange={(e) => setCcPermissionMode(e.target.value as any)}
              >
                {CC_PERMISSION_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <label className="text-sm text-neutral-400 sm:w-24 shrink-0">Binary Path</label>
              <input
                type="text"
                value={ccBinaryPath}
                onChange={(e) => setCcBinaryPath(e.target.value)}
                placeholder="claude (leave blank for default)"
                className="w-full sm:w-64 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-neutral-200 text-sm focus:outline-none focus:border-blue-600 transition-colors"
              />
            </div>
          </div>
        )}
      </section>

    </div>
  );
}
