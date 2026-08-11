import { useEffect, useMemo, useState } from "react";
import { useSessions } from "../../hooks/useSessions";
import type { Settings, VitoConfig } from "../../utils/settingsResolution";
import { getEffectiveSettings } from "../../utils/settingsResolution";
import ScopedSettingsEditor from "./ScopedSettingsEditor";
import {
  removeSettingsValue,
  setSettingsValue,
  type SettingsPath,
  type SettingsUpdate,
} from "./settings-values";

interface SessionSettingsPanelProps {
  config: VitoConfig;
  onSave: (updates: Partial<VitoConfig>) => Promise<void>;
  initialSessionId?: string;
}

export default function SessionSettingsPanel({
  config,
  onSave,
  initialSessionId,
}: SessionSettingsPanelProps) {
  const sessionsQuery = useSessions();
  const sessions = sessionsQuery.data ?? [];
  const sessionOverrides = config.sessions || {};
  const availableSessionIds = useMemo(() => {
    const ids = new Set([
      ...sessions.map((session) => session.id),
      ...Object.keys(sessionOverrides),
      ...(initialSessionId ? [initialSessionId] : []),
    ]);
    return [...ids].filter((id) => !id.startsWith("system:"));
  }, [initialSessionId, sessionOverrides, sessions]);
  const [selectedSession, setSelectedSession] = useState(initialSessionId ?? "");

  useEffect(() => {
    if (initialSessionId && availableSessionIds.includes(initialSessionId)) {
      setSelectedSession(initialSessionId);
      return;
    }
    if (!selectedSession || !availableSessionIds.includes(selectedSession)) {
      setSelectedSession(availableSessionIds[0] ?? "");
    }
  }, [availableSessionIds, initialSessionId, selectedSession]);

  const saveSessionSettings = async (newSettings: Settings) => {
    if (!selectedSession) return;
    const newSessions = { ...sessionOverrides };
    if (Object.keys(newSettings).length === 0) delete newSessions[selectedSession];
    else newSessions[selectedSession] = newSettings;
    await onSave({ sessions: newSessions });
  };

  const updateSessionSetting = async (update: SettingsUpdate) => {
    const current = sessionOverrides[selectedSession] || {};
    await saveSessionSettings(setSettingsValue(current, update));
  };

  const resetSessionSetting = async (path: SettingsPath) => {
    const current = sessionOverrides[selectedSession] || {};
    await saveSessionSettings(removeSettingsValue(current, path));
  };

  const removeAllOverrides = async () => {
    await saveSessionSettings({});
  };

  if (sessionsQuery.isPending) {
    return <div className="text-sm text-neutral-500 p-4">Loading sessions...</div>;
  }

  if (availableSessionIds.length === 0) {
    return <div className="text-sm text-neutral-500 p-4">No user sessions available.</div>;
  }

  const selectedMetadata = sessions.find((session) => session.id === selectedSession);
  const channel = selectedSession.split(":")[0];
  const inherited = getEffectiveSettings(config, channel);
  const inheritedFrom = config.channels?.[channel]?.settings
    ? ("channel" as const)
    : ("global" as const);
  const overrides = sessionOverrides[selectedSession] || {};

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
          Session
        </label>
        <select
          value={selectedSession}
          onChange={(event) => setSelectedSession(event.target.value)}
          className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2.5 text-neutral-200 text-sm focus:outline-none focus:border-blue-600"
        >
          {availableSessionIds.map((id) => {
            const session = sessions.find((candidate) => candidate.id === id);
            const name = session?.alias || id;
            return (
              <option key={id} value={id}>
                {name} ({id})
              </option>
            );
          })}
        </select>
        <div className="flex items-center gap-2 mt-2 text-xs text-neutral-600">
          <span className="uppercase text-blue-400">{channel}</span>
          {selectedMetadata?.alias && <span className="font-mono">{selectedSession}</span>}
        </div>
      </div>

      <ScopedSettingsEditor
        key={selectedSession}
        inherited={inherited}
        inheritedFrom={inheritedFrom}
        overrides={overrides}
        scope="session"
        onUpdate={updateSessionSetting}
        onReset={resetSessionSetting}
        onResetAll={removeAllOverrides}
      />
    </div>
  );
}
