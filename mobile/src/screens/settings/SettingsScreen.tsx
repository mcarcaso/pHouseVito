import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { api, getSessions, type Session } from "../../services/api/client";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";
import { createSettingsStyles } from "./styles";

import {
  ChannelSetup,
  ChoiceField,
  ModelField,
  Section,
  SegmentField,
  TextField,
  ToggleField,
  streamModes,
  thinkingLevels,
  timezones,
  type Dict,
  type Scope,
} from "./SettingsFields";

export function SettingsScreen({
  onUnauthorized,
  showHeader = true,
}: {
  onUnauthorized: () => void;
  showHeader?: boolean;
}) {
  const styles = useThemeStyles(createSettingsStyles);
  const theme = useVitoTheme();
  const [config, setConfig] = useState<Dict | null>(null);
  const [scope, setScope] = useState<Scope>("global");
  const [channel, setChannel] = useState("");
  const [session, setSession] = useState("");
  const [availableSessions, setAvailableSessions] = useState<Session[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<Dict>("/api/config")
      .then((value) => {
        setConfig(value);
        setChannel(Object.keys(value.channels ?? {})[0] ?? "");
        const configured = Object.keys(value.sessions ?? {});
        setSession(configured[0] ?? "");
        void getSessions().then((sessions) => {
          const visible = sessions.filter((item) => !item.id.startsWith("system:"));
          setAvailableSessions(visible);
          setSession((current) => current || visible[0]?.id || "");
        });
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : "Could not load settings";
        if (message.toLowerCase().includes("unauthorized")) onUnauthorized();
        setError(message);
      });
  }, [onUnauthorized]);

  const overrides = useMemo(() => {
    if (!config) return {};
    if (scope === "global") return config.settings ?? {};
    if (scope === "channel") return config.channels?.[channel]?.settings ?? {};
    return config.sessions?.[session] ?? {};
  }, [channel, config, scope, session]);
  const globalSettings = config?.settings ?? {};
  const inherited =
    scope === "session"
      ? mergeSettings(globalSettings, config?.channels?.[session.split(":")[0]]?.settings ?? {})
      : globalSettings;

  const savePatch = async (patch: Dict) => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const next = await api<Dict>("/api/config", { method: "PUT", body: JSON.stringify(patch) });
      setConfig(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = (path: string[], value: unknown) => {
    if (!config) return;
    const nextSettings = setPath(overrides, path, value);
    if (scope === "global") void savePatch({ settings: nextSettings });
    else if (scope === "channel")
      void savePatch({
        channels: {
          ...config.channels,
          [channel]: { ...config.channels[channel], settings: nextSettings },
        },
      });
    else void savePatch({ sessions: { ...config.sessions, [session]: nextSettings } });
  };

  const resetSetting = (path: string[]) => {
    if (!config) return;
    const nextSettings = removePath(overrides, path);
    if (scope === "channel")
      void savePatch({
        channels: {
          ...config.channels,
          [channel]: { ...config.channels[channel], settings: nextSettings },
        },
      });
    if (scope === "session")
      void savePatch({ sessions: { ...config.sessions, [session]: nextSettings } });
  };

  const resetAllOverrides = () => {
    if (!config || scope === "global") return;
    if (scope === "channel") {
      const nextChannel = { ...config.channels[channel] };
      delete nextChannel.settings;
      void savePatch({ channels: { ...config.channels, [channel]: nextChannel } });
    } else {
      const nextSessions = { ...config.sessions };
      delete nextSessions[session];
      void savePatch({ sessions: nextSessions });
    }
  };

  if (!config)
    return (
      <View style={styles.loading}>
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <ActivityIndicator color={theme.colors.accent} />
        )}
      </View>
    );
  const channelNames = Object.keys(config.channels ?? {});
  const sessionIds = [
    ...new Set([
      ...availableSessions.map((item) => item.id),
      ...Object.keys(config.sessions ?? {}),
    ]),
  ].filter((id) => !id.startsWith("system:"));
  const sessionOptions = sessionIds
    .map((id) => {
      const metadata = availableSessions.find((item) => item.id === id);
      const count = countLeaves(config.sessions?.[id] ?? {});
      return {
        value: id,
        label: metadata?.alias ? `${metadata.alias} (${id})` : id,
        group: count > 0 ? `Overrides configured` : `Inheriting only`,
        badge: count > 0 ? `${count} override${count === 1 ? "" : "s"}` : undefined,
      };
    })
    .sort(
      (left, right) =>
        Number(Boolean(right.badge)) - Number(Boolean(left.badge)) ||
        left.label.localeCompare(right.label),
    );
  const effective =
    scope === "global"
      ? overrides
      : {
          ...inherited,
          ...overrides,
          "pi-coding-agent": { ...inherited["pi-coding-agent"], ...overrides["pi-coding-agent"] },
          memory: { ...inherited.memory, ...overrides.memory },
        };

  return (
    <View style={styles.root}>
      {showHeader && (
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <Text style={saved ? styles.saved : styles.status}>
            {saving ? "Saving…" : saved ? "Saved" : ""}
          </Text>
        </View>
      )}
      {!showHeader && (saving || saved) && (
        <Text style={[styles.inlineStatus, saved && styles.saved]}>
          {saving ? "Saving…" : "Saved"}
        </Text>
      )}
      <View style={styles.tabs}>
        {(["global", "channel", "session"] as Scope[]).map((item) => (
          <Pressable
            key={item}
            onPress={() => setScope(item)}
            style={[styles.tab, scope === item && styles.tabActive]}
          >
            <Text style={[styles.tabText, scope === item && styles.tabTextActive]}>
              {capitalize(item)}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {error && <Text style={styles.error}>{error}</Text>}
        {scope === "channel" && (
          <View style={styles.section}>
            <ChoiceField
              label="Channel"
              options={channelNames}
              value={channel}
              onChange={setChannel}
              styles={styles}
            />
          </View>
        )}
        {scope === "session" && (
          <View style={styles.section}>
            <ChoiceField
              label="Session"
              options={sessionOptions}
              value={session}
              onChange={setSession}
              styles={styles}
            />
            {session && (
              <View style={styles.sessionMeta}>
                <Text style={styles.sessionChannel}>{session.split(":")[0].toUpperCase()}</Text>
                <Text
                  style={
                    countLeaves(config.sessions?.[session] ?? {}) > 0
                      ? styles.overrideBadge
                      : styles.inheritBadge
                  }
                >
                  {countLeaves(config.sessions?.[session] ?? {}) > 0
                    ? `${countLeaves(config.sessions?.[session] ?? {})} overrides`
                    : "Inheriting only"}
                </Text>
              </View>
            )}
          </View>
        )}
        {scope === "global" && (
          <Section title="Global setup" styles={styles}>
            <TextField
              label="Bot name"
              value={config.bot?.name ?? ""}
              onCommit={(value) => void savePatch({ bot: { ...config.bot, name: value } })}
              styles={styles}
            />
          </Section>
        )}
        {scope === "channel" && channel && (
          <ChannelSetup channel={channel} config={config} onSave={savePatch} styles={styles} />
        )}
        {scope !== "global" && countLeaves(overrides) > 0 && (
          <Pressable onPress={resetAllOverrides} style={styles.resetAllButton}>
            <Text style={styles.resetAllText}>
              Reset all {countLeaves(overrides)} override{countLeaves(overrides) === 1 ? "" : "s"}
            </Text>
          </Pressable>
        )}
        <Section
          title="Cascading settings"
          subtitle={
            scope === "global"
              ? "Base values inherited by channels and sessions."
              : "Overridden fields are marked and can be reset individually."
          }
          styles={styles}
        >
          <SegmentField
            label="Stream mode"
            options={[...streamModes]}
            value={effective.streamMode ?? "stream"}
            overridden={scope !== "global" && overrides.streamMode !== undefined}
            onChange={(v) => updateSetting(["streamMode"], v)}
            onReset={() => resetSetting(["streamMode"])}
            styles={styles}
          />
          <ToggleField
            label="Require @mention"
            value={effective.requireMention !== false}
            overridden={scope !== "global" && overrides.requireMention !== undefined}
            onChange={(v) => updateSetting(["requireMention"], v)}
            onReset={() => resetSetting(["requireMention"])}
            styles={styles}
          />
          <ToggleField
            label="Trace message updates"
            hint="Log raw message_update events in traces"
            value={effective.traceMessageUpdates === true}
            overridden={scope !== "global" && overrides.traceMessageUpdates !== undefined}
            onChange={(v) => updateSetting(["traceMessageUpdates"], v)}
            onReset={() => resetSetting(["traceMessageUpdates"])}
            styles={styles}
          />
          <ChoiceField
            label="Timezone"
            options={timezones}
            value={effective.timezone ?? "America/Toronto"}
            overridden={scope !== "global" && overrides.timezone !== undefined}
            onChange={(v) => updateSetting(["timezone"], v)}
            onReset={() => resetSetting(["timezone"])}
            styles={styles}
          />
          <TextField
            label="Custom instructions"
            multiline
            value={effective.customInstructions ?? ""}
            overridden={scope !== "global" && overrides.customInstructions !== undefined}
            onCommit={(v) => updateSetting(["customInstructions"], v)}
            onReset={() => resetSetting(["customInstructions"])}
            styles={styles}
          />
        </Section>
        <Section title="Memory" styles={styles}>
          <ModelField
            label="Chunk contextualizer"
            value={effective.memory?.chunkContextualizerModel}
            overridden={
              scope !== "global" && overrides.memory?.chunkContextualizerModel !== undefined
            }
            onChange={(v) => updateSetting(["memory", "chunkContextualizerModel"], v)}
            onReset={() => resetSetting(["memory", "chunkContextualizerModel"])}
            styles={styles}
          />
        </Section>
        <Section title="Pi coding agent" styles={styles}>
          <ModelField
            label="Model"
            value={effective["pi-coding-agent"]?.model}
            overridden={scope !== "global" && overrides["pi-coding-agent"]?.model !== undefined}
            onChange={(v) => updateSetting(["pi-coding-agent", "model"], v)}
            onReset={() => resetSetting(["pi-coding-agent", "model"])}
            styles={styles}
          />
          <SegmentField
            label="Thinking level"
            options={[...thinkingLevels]}
            value={effective["pi-coding-agent"]?.thinkingLevel ?? "low"}
            overridden={
              scope !== "global" && overrides["pi-coding-agent"]?.thinkingLevel !== undefined
            }
            onChange={(v) => updateSetting(["pi-coding-agent", "thinkingLevel"], v)}
            onReset={() => resetSetting(["pi-coding-agent", "thinkingLevel"])}
            styles={styles}
          />
        </Section>
      </ScrollView>
    </View>
  );
}

function mergeSettings(base: Dict, override: Dict): Dict {
  return {
    ...base,
    ...override,
    memory: { ...(base.memory ?? {}), ...(override.memory ?? {}) },
    "pi-coding-agent": {
      ...(base["pi-coding-agent"] ?? {}),
      ...(override["pi-coding-agent"] ?? {}),
    },
  };
}
function setPath(source: Dict, path: string[], value: unknown): Dict {
  const next = { ...source };
  let cursor = next;
  path.forEach((key, i) => {
    if (i === path.length - 1) cursor[key] = value;
    else {
      cursor[key] = { ...(cursor[key] ?? {}) };
      cursor = cursor[key];
    }
  });
  return next;
}
function removePath(source: Dict, path: string[]): Dict {
  const remove = (value: Dict, index: number): Dict => {
    const next = { ...value };
    const key = path[index];
    if (index === path.length - 1) delete next[key];
    else if (next[key] && typeof next[key] === "object") {
      const child = remove(next[key], index + 1);
      if (Object.keys(child).length === 0) delete next[key];
      else next[key] = child;
    }
    return next;
  };
  return remove(source, 0);
}
function countLeaves(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  return Object.values(value as Dict).reduce(
    (count, item) =>
      count + (item && typeof item === "object" && !Array.isArray(item) ? countLeaves(item) : 1),
    0,
  );
}
function capitalize(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}
