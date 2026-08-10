import { useEffect, useState } from "react";
import type { VitoConfig, Settings } from "../../utils/settingsResolution";
import { useSessions } from "../../hooks/useSessions";
import { countActiveSettingOverrides, getEffectiveSettings } from "../../utils/settingsResolution";
import ScopedSettingsFields from "./ScopedSettingsFields";
import PiSettingsOverrideFields from "./PiSettingsOverrideFields";
import {
  removeSettingsValue,
  setSettingsValue,
  type SettingsPath,
  type SettingsUpdate,
} from "./settings-values";

interface SessionSettingsPanelProps {
  config: VitoConfig;
  onSave: (updates: Partial<VitoConfig>) => Promise<void>;
  /** Pre-select a session (from query params) */
  initialSessionId?: string;
}

export default function SessionSettingsPanel({
  config,
  onSave,
  initialSessionId,
}: SessionSettingsPanelProps) {
  const sessionsQuery = useSessions();
  const sessions = sessionsQuery.data ?? [];
  const loading = sessionsQuery.isPending;
  const [expandedSession, setExpandedSession] = useState<string | null>(initialSessionId || null);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (initialSessionId) setExpandedSession(initialSessionId);
  }, [initialSessionId]);

  const sessionOverrides = config.sessions || {};
  const sessionIds = Object.keys(sessionOverrides);

  const getChannelFromSessionId = (sessionId: string) => sessionId.split(":")[0];

  // Get what the session would inherit if it had no overrides
  const getInheritedForSession = (sessionId: string) => {
    const channel = getChannelFromSessionId(sessionId);
    return getEffectiveSettings(config, channel);
  };

  const saveSessionSettings = async (sessionId: string, newSettings: Settings) => {
    await onSave({ sessions: { ...sessionOverrides, [sessionId]: newSettings } });
  };

  const updateSessionSetting = async (sessionId: string, update: SettingsUpdate) => {
    const current = sessionOverrides[sessionId] || {};
    await saveSessionSettings(sessionId, setSettingsValue(current, update));
  };

  const resetSessionSetting = async (sessionId: string, path: SettingsPath) => {
    const current = sessionOverrides[sessionId] || {};
    const newSettings = removeSettingsValue(current, path);

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
    if (mins < 1) return "just now";
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
    const inheritFrom = config.channels?.[channel]?.settings
      ? ("channel" as const)
      : ("global" as const);

    return (
      <div className="px-5 pb-5 border-t border-neutral-800/50">
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-neutral-600">
            Overrides inherit from {inheritFrom === "channel" ? `Channel (${channel})` : "Global"}.
          </p>
          <button
            onClick={() => removeAllOverrides(sessionId)}
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            Remove All Overrides
          </button>
        </div>

        <div className="mt-3">
          <ScopedSettingsFields
            inherited={inherited}
            inheritedFrom={inheritFrom}
            overrides={overrides}
            instructionScope="session"
            onUpdate={(update) => void updateSessionSetting(sessionId, update)}
            onReset={(path) => void resetSessionSetting(sessionId, path)}
          />

          {/* Pi Coding Agent Overrides */}
          <div className="mt-5 mb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                Pi Coding Agent Config
              </span>
              <span className="text-xs text-neutral-600">Per-session Pi overrides</span>
            </div>
          </div>

          <PiSettingsOverrideFields
            inherited={inherited["pi-coding-agent"]}
            fallback={config.settings?.["pi-coding-agent"]}
            inheritedFrom={inheritFrom}
            overrides={overrides["pi-coding-agent"]}
            onUpdate={(update) => void updateSessionSetting(sessionId, update)}
            onReset={(path) => void resetSessionSetting(sessionId, path)}
          />
        </div>
      </div>
    );
  };

  const regularSessionIds = sessionIds.filter((id) => !id.startsWith("system:"));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">
              User Sessions
            </span>
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
                  .filter((s) => !sessionIds.includes(s.id) && !s.id.startsWith("system:"))
                  .map((s) => (
                    <button
                      key={s.id}
                      onClick={() => addSessionOverride(s.id)}
                      className="w-full text-left px-3 py-3 rounded-lg hover:bg-neutral-800 transition-colors border border-transparent hover:border-neutral-700"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-blue-400 text-xs font-medium uppercase tracking-wide">
                          {s.channel}
                        </span>
                        <span className="text-xs text-neutral-600">
                          {formatRelativeTime(s.last_active_at)}
                        </span>
                      </div>
                      <div className="text-neutral-200 text-sm font-medium">
                        {s.alias || s.id.split(":")[1] || s.id}
                      </div>
                      {s.alias && (
                        <div className="text-neutral-500 text-xs font-mono mt-0.5">{s.id}</div>
                      )}
                    </button>
                  ))}
                {sessions.filter((s) => !sessionIds.includes(s.id) && !s.id.startsWith("system:"))
                  .length === 0 && (
                  <span className="text-xs text-neutral-500">
                    All sessions already have overrides configured.
                  </span>
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
              <p className="text-xs text-neutral-600 mt-1">
                Click "+ Add Override" to configure settings for a specific session.
              </p>
            </div>
          )}

          {regularSessionIds.map((sessionId) => {
            const session = sessions.find((s) => s.id === sessionId);
            const overrideCount = countActiveSettingOverrides(sessionOverrides[sessionId]);
            const isExpanded = expandedSession === sessionId;

            return (
              <div
                key={sessionId}
                className="bg-[#151515] border border-neutral-800 rounded-xl overflow-hidden"
              >
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
                          {overrideCount} override{overrideCount !== 1 ? "s" : ""}
                        </span>
                      )}
                      {session && (
                        <span className="text-xs text-neutral-600">
                          {formatRelativeTime(session.last_active_at)}
                        </span>
                      )}
                      <span
                        className={`text-neutral-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      >
                        ▼
                      </span>
                    </div>
                  </div>

                  {/* Main content: alias name prominently displayed */}
                  <div className="text-neutral-200 text-base font-medium">
                    {session?.alias || sessionId.split(":")[1] || sessionId}
                  </div>

                  {/* Bottom row: full session ID (only if alias exists) */}
                  {session?.alias && (
                    <div className="text-neutral-500 text-xs font-mono mt-1">{sessionId}</div>
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
