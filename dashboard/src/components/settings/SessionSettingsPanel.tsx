import { useState, useEffect } from 'react';
import type { VitoConfig, Settings } from '../../utils/settingsResolution';
import { countActiveSettingOverrides, getEffectiveSettings } from '../../utils/settingsResolution';
import SettingRow, { renderSelect, renderSegmented, renderToggle, renderTextarea } from './SettingRow';

interface SessionSettingsPanelProps {
  config: VitoConfig;
  onSave: (updates: Partial<VitoConfig>) => Promise<void>;
  /** Pre-select a session (from query params) */
  initialSessionId?: string;
}

interface SessionInfo {
  id: string;
  channel: string;
  channel_target: string;
  last_active_at: number;
  alias: string | null;
}

interface ModelOption {
  id: string;
}

interface AuthStatus {
  hasAuth: boolean;
  authType?: 'apiKey' | 'oauth';
}

const STREAM_MODES = [
  { value: 'stream', label: 'Stream' },
  { value: 'bundled', label: 'Bundled' },
  { value: 'final', label: 'Final' },
];

const HARNESSES = [
  { value: 'pi-coding-agent', label: 'Pi' },
  { value: 'claude-code', label: 'Claude Code' },
];

const THINKING_LEVELS = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

function setNestedValue(target: Record<string, any>, path: string, value: any) {
  const parts = path.split('.');
  let cursor: Record<string, any> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    cursor[key] = { ...(cursor[key] || {}) };
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

function deleteNestedValue(target: Record<string, any>, path: string) {
  const parts = path.split('.');
  const stack: Array<{ parent: Record<string, any>; key: string }> = [];
  let cursor: Record<string, any> | undefined = target;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!cursor?.[key] || typeof cursor[key] !== 'object') return;
    stack.push({ parent: cursor, key });
    cursor = cursor[key];
  }

  if (!cursor) return;
  delete cursor[parts[parts.length - 1]];

  for (let i = stack.length - 1; i >= 0; i--) {
    const { parent, key } = stack[i];
    if (parent[key] && typeof parent[key] === 'object' && Object.keys(parent[key]).length === 0) {
      delete parent[key];
    }
  }
}

export default function SessionSettingsPanel({ config, onSave, initialSessionId }: SessionSettingsPanelProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSession, setExpandedSession] = useState<string | null>(initialSessionId || null);
  const [showPicker, setShowPicker] = useState(false);

  // For pi-coding-agent model selection
  const [providers, setProviders] = useState<string[]>([]);
  const [authStatus, setAuthStatus] = useState<Record<string, AuthStatus>>({});
  const [models, setModels] = useState<Record<string, ModelOption[]>>({});
  const [loadingModels, setLoadingModels] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/sessions')
      .then((r) => r.json())
      .then((data) => {
        setSessions(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    // Fetch providers for pi-coding-agent overrides
    fetch('/api/models/providers')
      .then((r) => r.json())
      .then((data) => {
        setProviders(data.providers || []);
        setAuthStatus(data.authStatus || {});
      })
      .catch(console.error);
  }, []);

  const loadModelsForProvider = async (provider: string) => {
    if (models[provider]) return; // Already loaded
    setLoadingModels(provider);
    try {
      const res = await fetch(`/api/models/${provider}`);
      const data = await res.json();
      setModels(prev => ({ ...prev, [provider]: data }));
    } catch {
      setModels(prev => ({ ...prev, [provider]: [] }));
    }
    setLoadingModels(null);
  };

  const availableProviders = providers.filter((p) => authStatus[p]?.hasAuth === true);
  const popularProviders = ['anthropic', 'openai', 'openai-codex', 'google', 'xai', 'groq', 'mistral', 'openrouter'];
  const sortedProviders = [
    ...popularProviders.filter((p) => availableProviders.includes(p)),
    ...availableProviders.filter((p) => !popularProviders.includes(p)).sort(),
  ];

  const sessionOverrides = config.sessions || {};
  const sessionIds = Object.keys(sessionOverrides);

  const getChannelFromSessionId = (sessionId: string) => sessionId.split(':')[0];

  // Get what the session would inherit if it had no overrides
  const getInheritedForSession = (sessionId: string) => {
    const channel = getChannelFromSessionId(sessionId);
    return getEffectiveSettings(config, channel);
  };

  const saveSessionSettings = async (sessionId: string, newSettings: Settings) => {
    await onSave({ sessions: { ...sessionOverrides, [sessionId]: newSettings } });
  };

  const updateSessionSetting = async (sessionId: string, field: string, value: any) => {
    const current = sessionOverrides[sessionId] || {};
    const newSettings: Settings = structuredClone(current);
    setNestedValue(newSettings as any, field, value);
    await saveSessionSettings(sessionId, newSettings);
  };

  const updateSessionSettingsBatch = async (sessionId: string, entries: Array<{ field: string; value: any }>) => {
    const current = sessionOverrides[sessionId] || {};
    const newSettings: Settings = structuredClone(current);
    for (const entry of entries) {
      setNestedValue(newSettings as any, entry.field, entry.value);
    }
    await saveSessionSettings(sessionId, newSettings);
  };

  const resetSessionSetting = async (sessionId: string, field: string) => {
    const current = sessionOverrides[sessionId] || {};
    const newSettings: Settings = structuredClone(current);
    deleteNestedValue(newSettings as any, field);

    // If empty, remove session entry entirely
    if (Object.keys(newSettings).length === 0) {
      const newSessions = { ...sessionOverrides };
      delete newSessions[sessionId];
      await onSave({ sessions: newSessions });
    } else {
      await onSave({ sessions: { ...sessionOverrides, [sessionId]: newSettings } });
    }
  };

  const resetSessionSettingsBatch = async (sessionId: string, fields: string[]) => {
    const current = sessionOverrides[sessionId] || {};
    const newSettings: Settings = structuredClone(current);
    for (const field of fields) {
      deleteNestedValue(newSettings as any, field);
    }
    if (Object.keys(newSettings).length === 0) {
      const newSessions = { ...sessionOverrides };
      delete newSessions[sessionId];
      await onSave({ sessions: newSessions });
    } else {
      await onSave({ sessions: { ...sessionOverrides, [sessionId]: newSettings } });
    }
  };

  const removeAllOverrides = async (sessionId: string) => {
    // Send null values so backend removes the keys
    const current = sessionOverrides[sessionId] || {};
    const nullConfig: any = {};
    for (const key of Object.keys(current)) {
      nullConfig[key] = null;
    }
    // Update local config
    const newSessions = { ...sessionOverrides };
    delete newSessions[sessionId];
    await onSave({ sessions: newSessions });
    if (expandedSession === sessionId) setExpandedSession(null);
  };

  const addSessionOverride = async (sessionId: string) => {
    // Just create an empty entry — user will add overrides via SettingRow
    await onSave({ sessions: { ...sessionOverrides, [sessionId]: {} } });
    setExpandedSession(sessionId);
    setShowPicker(false);
  };

  const formatRelativeTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // Get the global harness config as the "inherited" value for harness-specific settings
  const getGlobalPiConfig = () => config.harnesses?.['pi-coding-agent'] || { model: { provider: '', name: '' } };

  const renderPiCodingAgentOverrides = (
    sessionId: string,
    overrides: Settings,
    inherited: ReturnType<typeof getEffectiveSettings>,
    inheritFrom: 'global' | 'channel'
  ) => {
    const globalPi = getGlobalPiConfig();
    const piOverrides = overrides['pi-coding-agent'] || {};
    // inherited['pi-coding-agent'] might be empty object, so check for model property
    const rawInherited = inherited['pi-coding-agent'];
    const piInherited = (rawInherited && rawInherited.model) ? rawInherited : globalPi;

    // Provider from override or inherited
    const currentProvider = piOverrides.model?.provider || piInherited.model?.provider || '';

    const providerOptions = sortedProviders.map(p => ({ value: p, label: p }));
    const modelOptions = (models[currentProvider] || []).map(m => ({ value: m.id, label: m.id }));

    // Side effect: load models if needed (schedule for after render)
    if (currentProvider && !models[currentProvider] && loadingModels !== currentProvider) {
      setTimeout(() => loadModelsForProvider(currentProvider), 0);
    }

    return (
      <>
        <SettingRow
          label="Provider"
          inheritedValue={piInherited.model?.provider || '(not set)'}
          inheritedFrom={inheritFrom}
          overrideValue={piOverrides.model?.provider}
          onOverride={(val) => {
            loadModelsForProvider(val);
            updateSessionSetting(sessionId, 'pi-coding-agent.model', { provider: val, name: '' });
          }}
          onReset={() => resetSessionSetting(sessionId, 'pi-coding-agent.model')}
          renderInput={(val, onChange) => renderSelect(val, onChange, [{ value: '', label: 'Select...' }, ...providerOptions])}
        />

        <SettingRow
          label="Model"
          inheritedValue={piInherited.model?.name || '(not set)'}
          inheritedFrom={inheritFrom}
          overrideValue={piOverrides.model?.name}
          onOverride={(val) => {
            const provider = piOverrides.model?.provider || piInherited.model?.provider || '';
            updateSessionSetting(sessionId, 'pi-coding-agent.model', { provider, name: val });
          }}
          onReset={() => {
            // Keep provider if set, just reset model name
            if (piOverrides.model?.provider) {
              updateSessionSetting(sessionId, 'pi-coding-agent.model', { provider: piOverrides.model.provider, name: '' });
            } else {
              resetSessionSetting(sessionId, 'pi-coding-agent.model');
            }
          }}
          renderInput={(val, onChange) => (
            loadingModels === currentProvider ? (
              <span className="text-xs text-neutral-500">Loading...</span>
            ) : (
              renderSelect(val, onChange, [{ value: '', label: 'Select...' }, ...modelOptions])
            )
          )}
        />

        <SettingRow
          label="Thinking Level"
          inheritedValue={piInherited.thinkingLevel || 'off'}
          inheritedFrom={inheritFrom}
          overrideValue={piOverrides.thinkingLevel}
          onOverride={(val) => updateSessionSetting(sessionId, 'pi-coding-agent.thinkingLevel', val)}
          onReset={() => resetSessionSetting(sessionId, 'pi-coding-agent.thinkingLevel')}
          renderInput={(val, onChange) => renderSelect(val, onChange, THINKING_LEVELS)}
        />
      </>
    );
  };

  const renderSessionOverrides = (sessionId: string) => {
    const overrides = sessionOverrides[sessionId] || {};
    const inherited = getInheritedForSession(sessionId);
    const channel = getChannelFromSessionId(sessionId);
    const inheritFrom = config.channels?.[channel]?.settings ? 'channel' as const : 'global' as const;

    return (
      <div className="px-5 pb-5 border-t border-neutral-800/50">
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-neutral-600">Overrides inherit from {inheritFrom === 'channel' ? `Channel (${channel})` : 'Global'}.</p>
          <button
            onClick={() => removeAllOverrides(sessionId)}
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            Remove All Overrides
          </button>
        </div>

        <div className="mt-3">
          <SettingRow
            label="Harness"
            inheritedValue={inherited.harness}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.harness}
            onOverride={(val) => updateSessionSetting(sessionId, 'harness', val)}
            onReset={() => resetSessionSetting(sessionId, 'harness')}
            renderInput={(val, onChange) => renderSegmented(val, onChange, HARNESSES)}
          />

          <SettingRow
            label="Stream Mode"
            inheritedValue={inherited.streamMode}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.streamMode}
            onOverride={(val) => updateSessionSetting(sessionId, 'streamMode', val)}
            onReset={() => resetSessionSetting(sessionId, 'streamMode')}
            renderInput={(val, onChange) => renderSegmented(val, onChange, STREAM_MODES)}
          />

          <SettingRow
            label="Require @Mention"
            inheritedValue={inherited.requireMention !== false}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.requireMention}
            onOverride={(val) => updateSessionSetting(sessionId, 'requireMention', val)}
            onReset={() => resetSessionSetting(sessionId, 'requireMention')}
            renderInput={(val, onChange) => renderToggle(val, onChange)}
            formatValue={(v) => v ? 'On' : 'Off'}
          />

          <SettingRow
            label="Trace Message Updates"
            hint="Log raw message_update events in traces (noisy)"
            inheritedValue={inherited.traceMessageUpdates ?? false}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.traceMessageUpdates}
            onOverride={(val) => updateSessionSetting(sessionId, 'traceMessageUpdates', val)}
            onReset={() => resetSessionSetting(sessionId, 'traceMessageUpdates')}
            renderInput={(val, onChange) => renderToggle(val, onChange)}
            formatValue={(v) => v ? 'On' : 'Off'}
          />

          <SettingRow
            label="Custom Instructions"
            hint="Additional system prompt instructions for this session"
            inheritedValue={inherited.customInstructions || ''}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.customInstructions}
            onOverride={(val) => updateSessionSetting(sessionId, 'customInstructions', val)}
            onReset={() => resetSessionSetting(sessionId, 'customInstructions')}
            renderInput={(val, onChange) => renderTextarea(val, onChange, { placeholder: 'Custom instructions for this session...' })}
            formatValue={(v) => v ? `"${(v as string).slice(0, 50)}${(v as string).length > 50 ? '...' : ''}"` : '(none)'}
          />





          {/* Pi Coding Agent Overrides */}
          <div className="mt-5 mb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Pi Coding Agent Config</span>
              <span className="text-xs text-neutral-600">Used when harness = pi-coding-agent</span>
            </div>
          </div>

          {renderPiCodingAgentOverrides(sessionId, overrides, inherited, inheritFrom)}
        </div>
      </div>
    );
  };

  const regularSessionIds = sessionIds.filter(id => !id.startsWith('system:'));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">User Sessions</span>
            <span className="text-xs text-neutral-600">— per-conversation overrides</span>
          </div>
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
          >
            + Add Override
          </button>
        </div>

        {/* Session picker */}
        {showPicker && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 mb-3">
            <h4 className="text-sm font-semibold text-white mb-3">Select a session to configure</h4>
            {loading ? (
              <span className="text-xs text-neutral-500">Loading sessions...</span>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-2">
                {sessions
                  .filter((s) => !sessionIds.includes(s.id) && !s.id.startsWith('system:'))
                  .map((s) => (
                    <button
                      key={s.id}
                      onClick={() => addSessionOverride(s.id)}
                      className="w-full text-left px-3 py-3 rounded-lg hover:bg-neutral-800 transition-colors border border-transparent hover:border-neutral-700"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-blue-400 text-xs font-medium uppercase tracking-wide">{s.channel}</span>
                        <span className="text-xs text-neutral-600">{formatRelativeTime(s.last_active_at)}</span>
                      </div>
                      <div className="text-neutral-200 text-sm font-medium">
                        {s.alias || s.id.split(':')[1] || s.id}
                      </div>
                      {s.alias && (
                        <div className="text-neutral-500 text-xs font-mono mt-0.5">{s.id}</div>
                      )}
                    </button>
                  ))}
                {sessions.filter((s) => !sessionIds.includes(s.id) && !s.id.startsWith('system:')).length === 0 && (
                  <span className="text-xs text-neutral-500">All sessions already have overrides configured.</span>
                )}
              </div>
            )}
            <button
              onClick={() => setShowPicker(false)}
              className="mt-3 text-xs text-neutral-400 hover:text-neutral-300"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Session override cards */}
        <div className="space-y-3">
          {regularSessionIds.length === 0 && !showPicker && (
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-8 text-center">
              <p className="text-sm text-neutral-500">No user session overrides configured.</p>
              <p className="text-xs text-neutral-600 mt-1">Click "+ Add Override" to configure settings for a specific session.</p>
            </div>
          )}

          {regularSessionIds.map((sessionId) => {
            const session = sessions.find((s) => s.id === sessionId);
            const overrideCount = countActiveSettingOverrides(sessionOverrides[sessionId]);
            const isExpanded = expandedSession === sessionId;

            return (
              <div key={sessionId} className="bg-[#151515] border border-neutral-800 rounded-xl overflow-hidden">
                <button
                  className="w-full p-4 text-left hover:bg-neutral-800/30 transition-colors"
                  onClick={() => setExpandedSession(isExpanded ? null : sessionId)}
                >
                  {/* Top row: channel badge + metadata */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-blue-400 text-xs font-medium uppercase tracking-wide">
                      {getChannelFromSessionId(sessionId)}
                    </span>
                    <div className="flex items-center gap-3">
                      {overrideCount > 0 && (
                        <span className="text-xs bg-blue-900/40 text-blue-400 px-2 py-0.5 rounded-full">
                          {overrideCount} override{overrideCount !== 1 ? 's' : ''}
                        </span>
                      )}
                      {session && (
                        <span className="text-xs text-neutral-600">{formatRelativeTime(session.last_active_at)}</span>
                      )}
                      <span className={`text-neutral-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                        ▼
                      </span>
                    </div>
                  </div>

                  {/* Main content: alias name prominently displayed */}
                  <div className="text-neutral-200 text-base font-medium">
                    {session?.alias || sessionId.split(':')[1] || sessionId}
                  </div>

                  {/* Bottom row: full session ID (only if alias exists) */}
                  {session?.alias && (
                    <div className="text-neutral-500 text-xs font-mono mt-1">
                      {sessionId}
                    </div>
                  )}
                </button>

                {isExpanded && renderSessionOverrides(sessionId)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
