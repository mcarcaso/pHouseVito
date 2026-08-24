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

type Dict = Record<string, any>;
type Scope = "global" | "channel" | "session";
const streamModes = ["stream", "bundled", "final"] as const;
const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const timezones = [
  "America/Toronto",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "UTC",
];

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

function ChannelSetup({
  channel,
  config,
  onSave,
  styles,
}: {
  channel: string;
  config: Dict;
  onSave: (patch: Dict) => Promise<void>;
  styles: any;
}) {
  const channelConfig = config.channels?.[channel] ?? {};
  const managed = channel === "discord" || channel === "telegram";
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const run = async (action: "register-commands" | "auto-alias") => {
    setPending(action);
    setResult(null);
    try {
      const data = await api<Dict>(`/api/${channel}/${action}`, { method: "POST" });
      setResult({
        success: data.success === true,
        message:
          action === "register-commands"
            ? `Registered ${data.count ?? 0} command(s)`
            : `Updated ${data.updated ?? 0} session(s)${data.failed ? `, ${data.failed} failed` : ""}`,
      });
    } catch (cause) {
      setResult({
        success: false,
        message: cause instanceof Error ? cause.message : "Action failed",
      });
    } finally {
      setPending(null);
    }
  };
  const saveChannel = (changes: Dict) =>
    onSave({ channels: { ...config.channels, [channel]: { ...channelConfig, ...changes } } });
  const idFields =
    channel === "discord"
      ? ["allowedGuildIds", "allowedChannelIds"]
      : channel === "telegram"
        ? ["allowedChatIds"]
        : [];
  return (
    <Section
      title="Channel setup"
      subtitle={`Configuration specific to ${capitalize(channel)}.`}
      styles={styles}
    >
      <ToggleField
        label="Enabled"
        value={channelConfig.enabled === true}
        onChange={(value) => void saveChannel({ enabled: value })}
        styles={styles}
      />
      {managed && (
        <>
          <ActionField
            label={channel === "discord" ? "Slash commands" : "Bot commands"}
            description={
              channel === "discord"
                ? "Register Discord slash commands. Only needed when commands change."
                : "Register /new and /stop in Telegram's command menu."
            }
            button={
              pending === "register-commands"
                ? "Registering…"
                : channel === "discord"
                  ? "Register Slash Commands"
                  : "Register Bot Commands"
            }
            disabled={pending !== null}
            onPress={() => void run("register-commands")}
            styles={styles}
          />
          <ActionField
            label="Auto-generate aliases"
            description={
              channel === "discord"
                ? "Sets “Server / Channel” for sessions without an alias."
                : "Sets the chat name for sessions without an alias."
            }
            button={pending === "auto-alias" ? "Generating…" : "Set Default Aliases"}
            disabled={pending !== null}
            onPress={() => void run("auto-alias")}
            styles={styles}
          />
        </>
      )}
      {result && (
        <Text style={result.success ? styles.actionSuccess : styles.error}>
          {result.success ? "✓ " : "✗ "}
          {result.message}
        </Text>
      )}
      {idFields.map((field) => (
        <IdListField
          key={field}
          label={
            field === "allowedGuildIds"
              ? "Allowed server IDs"
              : field === "allowedChannelIds"
                ? "Allowed channel IDs"
                : "Allowed chat IDs"
          }
          values={channelConfig[field] ?? []}
          onChange={(values) => void saveChannel({ [field]: values })}
          styles={styles}
        />
      ))}
    </Section>
  );
}
function ActionField({
  label,
  description,
  button,
  disabled,
  onPress,
  styles,
}: {
  label: string;
  description: string;
  button: string;
  disabled: boolean;
  onPress: () => void;
  styles: any;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.hint}>{description}</Text>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        style={[styles.actionButton, disabled && styles.actionDisabled]}
      >
        <Text style={styles.actionButtonText}>{button}</Text>
      </Pressable>
    </View>
  );
}
function IdListField({
  label,
  values,
  onChange,
  styles,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  styles: any;
}) {
  const [input, setInput] = useState("");
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {values.length === 0 && <Text style={styles.hint}>None configured — all allowed</Text>}
      <View style={styles.idWrap}>
        {values.map((value) => (
          <Pressable
            key={value}
            onPress={() => onChange(values.filter((item) => item !== value))}
            style={styles.idChip}
          >
            <Text style={styles.idText}>{value} ×</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.idAdd}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Add ID"
          style={[styles.input, { flex: 1 }]}
        />
        <Pressable
          onPress={() => {
            const value = input.trim();
            if (value && !values.includes(value)) {
              onChange([...values, value]);
              setInput("");
            }
          }}
          style={styles.addButton}
        >
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>
    </View>
  );
}
function Section({
  title,
  subtitle,
  children,
  styles,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  styles: any;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      {children}
    </View>
  );
}
type ChoiceOption = string | { value: string; label: string; group?: string; badge?: string };
function ChoiceField({
  label,
  options,
  value,
  onChange,
  overridden,
  onReset,
  styles,
}: {
  label: string;
  options: ChoiceOption[];
  value: string;
  onChange: (v: string) => void;
  overridden?: boolean;
  onReset?: () => void;
  styles: any;
}) {
  const [open, setOpen] = useState(false);
  const normalized = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
  const selected = normalized.find((option) => option.value === value);
  let lastGroup: string | undefined;
  return (
    <Row {...{ label, overridden, onReset, styles }}>
      <Pressable onPress={() => setOpen(true)} style={styles.select}>
        <Text numberOfLines={1} style={styles.selectText}>
          {selected?.label || value || `Select ${label.toLowerCase()}…`}
        </Text>
        <Text style={styles.chevron}>⌄</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{label}</Text>
            <ScrollView>
              {normalized.map((option) => {
                const showGroup = option.group && option.group !== lastGroup;
                if (option.group) lastGroup = option.group;
                return (
                  <View key={option.value}>
                    {showGroup && <Text style={styles.optionGroup}>{option.group}</Text>}
                    <Pressable
                      onPress={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                      style={[styles.option, option.value === value && styles.optionActive]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.optionText,
                            option.value === value && styles.optionTextActive,
                          ]}
                        >
                          {option.label}
                        </Text>
                        {option.badge && <Text style={styles.optionBadge}>{option.badge}</Text>}
                      </View>
                      {option.value === value && <Text style={styles.check}>✓</Text>}
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </Row>
  );
}
function ModelField({
  label,
  value,
  onChange,
  overridden,
  onReset,
  styles,
}: {
  label: string;
  value?: { provider?: string; name?: string };
  onChange: (v: { provider: string; name: string }) => void;
  overridden?: boolean;
  onReset?: () => void;
  styles: any;
}) {
  const [provider, setProvider] = useState(value?.provider ?? "");
  const [providers, setProviders] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => {
    void api<Dict>("/api/models/providers").then((result) => {
      const all = (result.providers ?? []) as string[];
      const authenticated = all.filter((item) => result.authStatus?.[item]?.hasAuth === true);
      setProviders(
        authenticated.includes(provider)
          ? authenticated
          : [provider, ...authenticated].filter(Boolean),
      );
    });
  }, [provider]);
  useEffect(() => {
    if (!provider) {
      setModels([]);
      return;
    }
    void api<Array<{ id: string }>>(`/api/models/${encodeURIComponent(provider)}`).then((result) =>
      setModels(result.map((item) => item.id)),
    );
  }, [provider]);
  useEffect(() => setProvider(value?.provider ?? ""), [value?.provider]);
  return (
    <>
      <ChoiceField
        label={`${label} provider`}
        options={providers}
        value={provider}
        onChange={(next) => {
          setProvider(next);
          setModels([]);
        }}
        overridden={overridden}
        onReset={onReset}
        styles={styles}
      />
      <ChoiceField
        label={`${label} name`}
        options={models}
        value={provider === value?.provider ? (value?.name ?? "") : ""}
        onChange={(name) => onChange({ provider, name })}
        styles={styles}
      />
    </>
  );
}
function Row({
  label,
  hint,
  overridden,
  onReset,
  children,
  styles,
}: {
  label: string;
  hint?: string;
  overridden?: boolean;
  onReset?: () => void;
  children: React.ReactNode;
  styles: any;
}) {
  return (
    <View style={[styles.row, overridden && styles.rowOverridden]}>
      <View style={styles.rowHeading}>
        <View
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}
        >
          <Text style={styles.label}>{label}</Text>
          {overridden && <Text style={styles.overrideLabel}>OVERRIDE</Text>}
          {hint && <Text style={[styles.hint, { width: "100%" }]}>{hint}</Text>}
        </View>
        {overridden && onReset && (
          <Pressable onPress={onReset}>
            <Text style={styles.reset}>Reset</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}
function TextField({
  label,
  value,
  onCommit,
  multiline,
  overridden,
  onReset,
  styles,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  overridden?: boolean;
  onReset?: () => void;
  styles: any;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <Row {...{ label, overridden, onReset, styles }}>
      <TextInput
        value={local}
        onChangeText={setLocal}
        onBlur={() => local !== value && onCommit(local)}
        onSubmitEditing={() => !multiline && local !== value && onCommit(local)}
        multiline={multiline}
        style={[styles.input, multiline && styles.textarea]}
      />
    </Row>
  );
}
function ToggleField({
  label,
  hint,
  value,
  onChange,
  overridden,
  onReset,
  styles,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  overridden?: boolean;
  onReset?: () => void;
  styles: any;
}) {
  return (
    <Row {...{ label, hint, overridden, onReset, styles }}>
      <Switch value={value} onValueChange={onChange} />
    </Row>
  );
}
function SegmentField({
  label,
  options,
  value,
  onChange,
  overridden,
  onReset,
  styles,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  overridden?: boolean;
  onReset?: () => void;
  styles: any;
}) {
  return (
    <Row {...{ label, overridden, onReset, styles }}>
      <View style={styles.segments}>
        {options.map((v) => (
          <Pressable
            key={v}
            onPress={() => onChange(v)}
            style={[styles.segment, value === v && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, value === v && styles.segmentTextActive]}>{v}</Text>
          </Pressable>
        ))}
      </View>
    </Row>
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
