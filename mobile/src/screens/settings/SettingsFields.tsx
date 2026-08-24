import { useEffect, useState, type ReactNode } from "react";
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
import { api } from "../../services/api/client";
import { useThemeStyles, useVitoTheme } from "../../hooks/useVitoTheme";
import { createSettingsStyles } from "./styles";

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export type Dict = Record<string, any>;
export type Scope = "global" | "channel" | "session";
export const streamModes = ["stream", "bundled", "final"] as const;
export const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export const timezones = [
  "America/Toronto",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "UTC",
];

export function ChannelSetup({
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
export function ActionField({
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
export function IdListField({
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
export function Section({
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
export function ChoiceField({
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
export function ModelField({
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
export function Row({
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
export function TextField({
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
export function ToggleField({
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
export function SegmentField({
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
