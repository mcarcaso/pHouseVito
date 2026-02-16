import { useState, useEffect } from 'react';
import type { VitoConfig, Settings } from '../../utils/settingsResolution';
import { getEffectiveSettings } from '../../utils/settingsResolution';
import SettingRow, { renderSelect, renderSegmented, renderNumberInput } from './SettingRow';

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

const STREAM_MODES = [
  { value: 'stream', label: 'Stream' },
  { value: 'bundled', label: 'Bundled' },
  { value: 'final', label: 'Final' },
];

const HARNESS_OPTIONS = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'pi-coding-agent', label: 'Pi Coding Agent' },
];

export default function SessionSettingsPanel({ config, onSave, initialSessionId }: SessionSettingsPanelProps) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSession, setExpandedSession] = useState<string | null>(initialSessionId || null);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    fetch('/api/sessions')
      .then((r) => r.json())
      .then((data) => {
        setSessions(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const sessionOverrides = config.sessions || {};
  const sessionIds = Object.keys(sessionOverrides);

  const getChannelFromSessionId = (sessionId: string) => sessionId.split(':')[0];

  const resolveForSession = (sessionId: string) => {
    const channel = getChannelFromSessionId(sessionId);
    return getEffectiveSettings(config, channel, sessionId);
  };

  // Get what the session would inherit if it had no overrides
  const getInheritedForSession = (sessionId: string) => {
    const channel = getChannelFromSessionId(sessionId);
    return getEffectiveSettings(config, channel);
  };

  const updateSessionSetting = async (sessionId: string, field: string, value: any) => {
    const current = sessionOverrides[sessionId] || {};
    const newSettings: Settings = { ...current };
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      (newSettings as any)[parent] = { ...(newSettings as any)[parent], [child]: value };
    } else {
      (newSettings as any)[field] = value;
    }
    await onSave({ sessions: { ...sessionOverrides, [sessionId]: newSettings } });
  };

  const resetSessionSetting = async (sessionId: string, field: string) => {
    const current = sessionOverrides[sessionId] || {};
    const newSettings: Settings = { ...current };
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      if ((newSettings as any)[parent]) {
        delete (newSettings as any)[parent][child];
        if (Object.keys((newSettings as any)[parent]).length === 0) {
          delete (newSettings as any)[parent];
        }
      }
    } else {
      delete (newSettings as any)[field];
    }

    // If empty, remove session entry entirely
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
            renderInput={(val, onChange) => renderSelect(val, onChange, HARNESS_OPTIONS)}
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
            label="Session Limit"
            hint="Messages in current session context"
            inheritedValue={inherited.memory.currentSessionLimit}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.memory?.currentSessionLimit}
            onOverride={(val) => updateSessionSetting(sessionId, 'memory.currentSessionLimit', val)}
            onReset={() => resetSessionSetting(sessionId, 'memory.currentSessionLimit')}
            renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0 })}
          />

          <SettingRow
            label="Cross-Session Limit"
            hint="Messages per other session"
            inheritedValue={inherited.memory.crossSessionLimit}
            inheritedFrom={inheritFrom}
            overrideValue={overrides.memory?.crossSessionLimit}
            onOverride={(val) => updateSessionSetting(sessionId, 'memory.crossSessionLimit', val)}
            onReset={() => resetSessionSetting(sessionId, 'memory.crossSessionLimit')}
            renderInput={(val, onChange) => renderNumberInput(val, onChange, { min: 0 })}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-neutral-600">Per-session setting overrides. Most specific level in the cascade.</p>
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
        >
          + Add Override
        </button>
      </div>

      {/* Session picker */}
      {showPicker && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4">
          <h4 className="text-sm font-semibold text-white mb-3">Select a session to configure</h4>
          {loading ? (
            <span className="text-xs text-neutral-500">Loading sessions...</span>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-1">
              {sessions
                .filter((s) => !sessionIds.includes(s.id))
                .map((s) => (
                  <button
                    key={s.id}
                    onClick={() => addSessionOverride(s.id)}
                    className="w-full text-left flex items-center justify-between px-3 py-2 rounded-md hover:bg-neutral-800 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-blue-400 text-xs capitalize shrink-0">{s.channel}</span>
                      {s.alias ? (
                        <>
                          <span className="text-neutral-200 text-sm font-medium truncate">{s.alias}</span>
                          <span className="text-neutral-600 text-xs font-mono truncate">{s.id}</span>
                        </>
                      ) : (
                        <span className="text-neutral-300 text-sm font-mono truncate">{s.id}</span>
                      )}
                    </div>
                    <span className="text-xs text-neutral-600 shrink-0 ml-2">{formatRelativeTime(s.last_active_at)}</span>
                  </button>
                ))}
              {sessions.filter((s) => !sessionIds.includes(s.id)).length === 0 && (
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
      {sessionIds.length === 0 && !showPicker && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-8 text-center">
          <p className="text-sm text-neutral-500">No session overrides configured.</p>
          <p className="text-xs text-neutral-600 mt-1">Click "+ Add Override" to configure settings for a specific session.</p>
        </div>
      )}

      {sessionIds.map((sessionId) => {
        const session = sessions.find((s) => s.id === sessionId);
        const overrideCount = Object.keys(sessionOverrides[sessionId] || {}).length;
        const isExpanded = expandedSession === sessionId;

        return (
          <div key={sessionId} className="bg-[#151515] border border-neutral-800 rounded-xl overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-4 text-left hover:bg-neutral-800/30 transition-colors"
              onClick={() => setExpandedSession(isExpanded ? null : sessionId)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-blue-400 text-xs capitalize shrink-0">
                  {getChannelFromSessionId(sessionId)}
                </span>
                {session?.alias ? (
                  <>
                    <span className="text-neutral-200 text-sm font-medium truncate">{session.alias}</span>
                    <span className="text-neutral-600 text-xs font-mono truncate hidden sm:inline">{sessionId}</span>
                  </>
                ) : (
                  <span className="text-neutral-300 text-sm font-mono truncate">{sessionId}</span>
                )}
                {overrideCount > 0 && (
                  <span className="text-xs bg-blue-900/40 text-blue-400 px-2 py-0.5 rounded-full shrink-0">
                    {overrideCount} override{overrideCount !== 1 ? 's' : ''}
                  </span>
                )}
                {session && (
                  <span className="text-xs text-neutral-600 shrink-0">{formatRelativeTime(session.last_active_at)}</span>
                )}
              </div>
              <span className={`text-neutral-500 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}>
                ▼
              </span>
            </button>

            {isExpanded && renderSessionOverrides(sessionId)}
          </div>
        );
      })}
    </div>
  );
}
