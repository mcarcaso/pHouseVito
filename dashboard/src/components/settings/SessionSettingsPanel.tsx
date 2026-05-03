import { useState, useEffect } from 'react';
import type { VitoConfig, Settings } from '../../utils/settingsResolution';
import { getEffectiveSettings } from '../../utils/settingsResolution';
import SettingRow, { renderSelect, renderSegmented, renderNumberInput, renderToggle, renderTextarea } from './SettingRow';
import { ClassifierModelPicker } from './GlobalSettings';

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

const THINKING_LEVELS = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

// System sessions that always appear in the list (no message history required)
const SYSTEM_SESSIONS = [
  { id: 'system:profile-updater', label: 'Profile Updater', description: 'Background process that updates user/profile.md when new facts are revealed' },
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

          {/* Current Session Context */}
          <div className="mt-4 mb-2">
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Current Session Context</span>
          </div>

          <SettingRow
            label="Num Messages"
            inheritedValue={inherited.currentContext.limit}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.currentContext?.limit}
            onOverride={(val) => updateSessionSetting(sessionId, 'currentContext.limit', val)}
            onReset={() => resetSessionSetting(sessionId, 'currentContext.limit')}
            renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0 })}
          />

          <SettingRow
            label="Auto: Num Messages"
            hint="Classifier decides the current-session message window"
            inheritedValue={inherited.auto.currentContext.limit}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.auto?.currentContext?.limit}
            onOverride={(val) => updateSessionSetting(sessionId, 'auto.currentContext.limit', val)}
            onReset={() => resetSessionSetting(sessionId, 'auto.currentContext.limit')}
            renderInput={(val, onChange) => renderToggle(val, onChange)}
            formatValue={(v) => v ? 'On' : 'Off'}
          />

          <SettingRow
            label="Working Context"
            hint="Thoughts + tools together"
            inheritedValue={inherited.currentContext.includeThoughts && inherited.currentContext.includeTools}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.currentContext?.includeThoughts === undefined && overrides.currentContext?.includeTools === undefined
              ? undefined
              : (overrides.currentContext?.includeThoughts ?? inherited.currentContext.includeThoughts)
                && (overrides.currentContext?.includeTools ?? inherited.currentContext.includeTools)}
            onOverride={(val) => updateSessionSettingsBatch(sessionId, [
              { field: 'currentContext.includeThoughts', value: val },
              { field: 'currentContext.includeTools', value: val },
            ])}
            onReset={() => resetSessionSettingsBatch(sessionId, [
              'currentContext.includeThoughts',
              'currentContext.includeTools',
            ])}
            renderInput={(val, onChange) => renderToggle(val, onChange)}
            formatValue={(v) => v ? 'On' : 'Off'}
          />

          <SettingRow
            label="Auto: Working Context"
            hint="Classifier decides whether to include thoughts + tools"
            inheritedValue={inherited.auto.currentContext.includeWorkingContext}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.auto?.currentContext?.includeWorkingContext}
            onOverride={(val) => updateSessionSetting(sessionId, 'auto.currentContext.includeWorkingContext', val)}
            onReset={() => resetSessionSetting(sessionId, 'auto.currentContext.includeWorkingContext')}
            renderInput={(val, onChange) => renderToggle(val, onChange)}
            formatValue={(v) => v ? 'On' : 'Off'}
          />

          <SettingRow
            label="Archived"
            inheritedValue={inherited.currentContext.includeArchived}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.currentContext?.includeArchived}
            onOverride={(val) => updateSessionSetting(sessionId, 'currentContext.includeArchived', val)}
            onReset={() => resetSessionSetting(sessionId, 'currentContext.includeArchived')}
            renderInput={(val, onChange) => renderToggle(val, onChange)}
            formatValue={(v) => v ? 'On' : 'Off'}
          />

          <SettingRow
            label="Exclude Embedded"
            hint="Skip messages already covered by embeddings"
            inheritedValue={inherited.currentContext.excludeEmbedded}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.currentContext?.excludeEmbedded}
            onOverride={(val) => updateSessionSetting(sessionId, 'currentContext.excludeEmbedded', val)}
            onReset={() => resetSessionSetting(sessionId, 'currentContext.excludeEmbedded')}
            renderInput={(val, onChange) => renderToggle(val, onChange)}
            formatValue={(v) => v ? 'On' : 'Off'}
          />

          <SettingRow
            label="Keep Embedded Tail"
            hint="Recent embedded messages to keep anyway"
            inheritedValue={inherited.currentContext.keepRecentEmbeddedMessages}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.currentContext?.keepRecentEmbeddedMessages}
            onOverride={(val) => updateSessionSetting(sessionId, 'currentContext.keepRecentEmbeddedMessages', val)}
            onReset={() => resetSessionSetting(sessionId, 'currentContext.keepRecentEmbeddedMessages')}
            renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0, max: 50 })}
          />

          {/* Cross-Session Context */}
          <div className="mt-4 mb-2">
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Cross-Session Context</span>
          </div>

          <SettingRow
            label="Max Sessions"
            inheritedValue={inherited.crossContext.maxSessions}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.crossContext?.maxSessions}
            onOverride={(val) => updateSessionSetting(sessionId, 'crossContext.maxSessions', val)}
            onReset={() => resetSessionSetting(sessionId, 'crossContext.maxSessions')}
            renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0 })}
          />

          <SettingRow
            label="Auto: Max Sessions"
            hint="Classifier decides how many other sessions to pull from"
            inheritedValue={inherited.auto.crossContext.maxSessions}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.auto?.crossContext?.maxSessions}
            onOverride={(val) => updateSessionSetting(sessionId, 'auto.crossContext.maxSessions', val)}
            onReset={() => resetSessionSetting(sessionId, 'auto.crossContext.maxSessions')}
            renderInput={(val, onChange) => renderToggle(val, onChange)}
            formatValue={(v) => v ? 'On' : 'Off'}
          />

          <SettingRow
            label="Num Messages"
            inheritedValue={inherited.crossContext.limit}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.crossContext?.limit}
            onOverride={(val) => updateSessionSetting(sessionId, 'crossContext.limit', val)}
            onReset={() => resetSessionSetting(sessionId, 'crossContext.limit')}
            renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0 })}
          />

          <SettingRow
            label="Auto: Num Messages"
            hint="Classifier decides the cross-session message window"
            inheritedValue={inherited.auto.crossContext.limit}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.auto?.crossContext?.limit}
            onOverride={(val) => updateSessionSetting(sessionId, 'auto.crossContext.limit', val)}
            onReset={() => resetSessionSetting(sessionId, 'auto.crossContext.limit')}
            renderInput={(val, onChange) => renderToggle(val, onChange)}
            formatValue={(v) => v ? 'On' : 'Off'}
          />

          <SettingRow
            label="Working Context"
            hint="Thoughts + tools together"
            inheritedValue={inherited.crossContext.includeThoughts && inherited.crossContext.includeTools}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.crossContext?.includeThoughts === undefined && overrides.crossContext?.includeTools === undefined
              ? undefined
              : (overrides.crossContext?.includeThoughts ?? inherited.crossContext.includeThoughts)
                && (overrides.crossContext?.includeTools ?? inherited.crossContext.includeTools)}
            onOverride={(val) => updateSessionSettingsBatch(sessionId, [
              { field: 'crossContext.includeThoughts', value: val },
              { field: 'crossContext.includeTools', value: val },
            ])}
            onReset={() => resetSessionSettingsBatch(sessionId, [
              'crossContext.includeThoughts',
              'crossContext.includeTools',
            ])}
            renderInput={(val, onChange) => renderToggle(val, onChange)}
            formatValue={(v) => v ? 'On' : 'Off'}
          />

          <SettingRow
            label="Auto: Working Context"
            hint="Classifier decides whether to include thoughts + tools from other sessions"
            inheritedValue={inherited.auto.crossContext.includeWorkingContext}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.auto?.crossContext?.includeWorkingContext}
            onOverride={(val) => updateSessionSetting(sessionId, 'auto.crossContext.includeWorkingContext', val)}
            onReset={() => resetSessionSetting(sessionId, 'auto.crossContext.includeWorkingContext')}
            renderInput={(val, onChange) => renderToggle(val, onChange)}
            formatValue={(v) => v ? 'On' : 'Off'}
          />

          <SettingRow
            label="Archived"
            inheritedValue={inherited.crossContext.includeArchived}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.crossContext?.includeArchived}
            onOverride={(val) => updateSessionSetting(sessionId, 'crossContext.includeArchived', val)}
            onReset={() => resetSessionSetting(sessionId, 'crossContext.includeArchived')}
            renderInput={(val, onChange) => renderToggle(val, onChange)}
            formatValue={(v) => v ? 'On' : 'Off'}
          />

          <div className="mt-4 mb-2">
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Memory Recall</span>
          </div>

          <SettingRow
            label="Recalled Memory Limit"
            hint="Max semantic chunks to inject"
            inheritedValue={inherited.memory.recalledMemoryLimit}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.memory?.recalledMemoryLimit}
            onOverride={(val) => updateSessionSetting(sessionId, 'memory.recalledMemoryLimit', val)}
            onReset={() => resetSessionSetting(sessionId, 'memory.recalledMemoryLimit')}
            renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0, max: 50 })}
          />

          <SettingRow
            label="Relevance Threshold"
            inheritedValue={inherited.memory.recalledMemoryThreshold}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.memory?.recalledMemoryThreshold}
            onOverride={(val) => updateSessionSetting(sessionId, 'memory.recalledMemoryThreshold', val)}
            onReset={() => resetSessionSetting(sessionId, 'memory.recalledMemoryThreshold')}
            renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0, max: 1, step: 0.001 })}
          />

          <SettingRow
            label="Profile Update Context"
            inheritedValue={inherited.memory.profileUpdateContext}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.memory?.profileUpdateContext}
            onOverride={(val) => updateSessionSetting(sessionId, 'memory.profileUpdateContext', val)}
            onReset={() => resetSessionSetting(sessionId, 'memory.profileUpdateContext')}
            renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 1, max: 10 })}
          />

          <SettingRow
            label="Contextualize Search Query"
            hint="Rewrite follow-up asks before semantic search"
            inheritedValue={inherited.memory.contextualizeQuery}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.memory?.contextualizeQuery}
            onOverride={(val) => updateSessionSetting(sessionId, 'memory.contextualizeQuery', val)}
            onReset={() => resetSessionSetting(sessionId, 'memory.contextualizeQuery')}
            renderInput={(val, onChange) => renderToggle(val, onChange)}
            formatValue={(v) => v ? 'On' : 'Off'}
          />

          <SettingRow
            label="Query Context Messages"
            inheritedValue={inherited.memory.queryContextMessages}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.memory?.queryContextMessages}
            onOverride={(val) => updateSessionSetting(sessionId, 'memory.queryContextMessages', val)}
            onReset={() => resetSessionSetting(sessionId, 'memory.queryContextMessages')}
            renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0, max: 50 })}
          />

          <SettingRow
            label="Query Contextualizer Model"
            inheritedValue={inherited.memory.queryContextualizerModel}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.memory?.queryContextualizerModel}
            onOverride={(val) => updateSessionSetting(sessionId, 'memory.queryContextualizerModel', val)}
            onReset={() => resetSessionSetting(sessionId, 'memory.queryContextualizerModel')}
            renderInput={(val, onChange) => <ClassifierModelPicker value={val} onChange={onChange} />}
            formatValue={(v) => v?.provider && v?.name ? `${v.provider}/${v.name}` : '—'}
          />

          <div className="mt-4 mb-2">
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Auto Classifier</span>
          </div>

          <SettingRow
            label="Classifier: Current Session Messages"
            hint="How many recent messages from this session the classifier reads"
            inheritedValue={inherited.auto.classifierContext.currentSessionMessages}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.auto?.classifierContext?.currentSessionMessages}
            onOverride={(val) => updateSessionSetting(sessionId, 'auto.classifierContext.currentSessionMessages', val)}
            onReset={() => resetSessionSetting(sessionId, 'auto.classifierContext.currentSessionMessages')}
            renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0, max: 300 })}
          />

          <SettingRow
            label="Classifier: Cross-Session Max Sessions"
            hint="How many other sessions the classifier may preview"
            inheritedValue={inherited.auto.classifierContext.crossSessionMaxSessions}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.auto?.classifierContext?.crossSessionMaxSessions}
            onOverride={(val) => updateSessionSetting(sessionId, 'auto.classifierContext.crossSessionMaxSessions', val)}
            onReset={() => resetSessionSetting(sessionId, 'auto.classifierContext.crossSessionMaxSessions')}
            renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0, max: 20 })}
          />

          <SettingRow
            label="Classifier: Cross-Session Messages"
            hint="How many recent messages per other session the classifier may preview"
            inheritedValue={inherited.auto.classifierContext.crossSessionMessages}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.auto?.classifierContext?.crossSessionMessages}
            onOverride={(val) => updateSessionSetting(sessionId, 'auto.classifierContext.crossSessionMessages', val)}
            onReset={() => resetSessionSetting(sessionId, 'auto.classifierContext.crossSessionMessages')}
            renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0, max: 20 })}
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

  // Separate system sessions from regular ones
  const regularSessionIds = sessionIds.filter(id => !id.startsWith('system:'));
  const systemSessionIds = SYSTEM_SESSIONS.map(s => s.id);

  return (
    <div className="space-y-6">
      {/* System Sessions - always visible */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">System Sessions</span>
          <span className="text-xs text-neutral-600">— background processes</span>
        </div>
        <div className="space-y-3">
          {SYSTEM_SESSIONS.map((systemSession) => {
            const overrideCount = Object.keys(sessionOverrides[systemSession.id] || {}).length;
            const isExpanded = expandedSession === systemSession.id;

            return (
              <div key={systemSession.id} className="bg-[#151515] border border-purple-900/50 rounded-xl overflow-hidden">
                <button
                  className="w-full p-4 text-left hover:bg-neutral-800/30 transition-colors"
                  onClick={() => setExpandedSession(isExpanded ? null : systemSession.id)}
                >
                  {/* Top row: system badge + metadata */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-purple-400 text-xs font-medium uppercase tracking-wide">
                      ⚙️ System
                    </span>
                    <div className="flex items-center gap-3">
                      {overrideCount > 0 && (
                        <span className="text-xs bg-purple-900/40 text-purple-400 px-2 py-0.5 rounded-full">
                          {overrideCount} override{overrideCount !== 1 ? 's' : ''}
                        </span>
                      )}
                      <span className={`text-neutral-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                        ▼
                      </span>
                    </div>
                  </div>
                  
                  {/* Main content: label prominently displayed */}
                  <div className="text-neutral-200 text-base font-medium">
                    {systemSession.label}
                  </div>
                  
                  {/* Description */}
                  <div className="text-neutral-500 text-xs mt-1">
                    {systemSession.description}
                  </div>
                  
                  {/* Session ID */}
                  <div className="text-neutral-600 text-xs font-mono mt-1">
                    {systemSession.id}
                  </div>
                </button>

                {isExpanded && renderSessionOverrides(systemSession.id)}
              </div>
            );
          })}
        </div>
      </div>

      {/* Regular Sessions */}
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
            const overrideCount = Object.keys(sessionOverrides[sessionId] || {}).length;
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
