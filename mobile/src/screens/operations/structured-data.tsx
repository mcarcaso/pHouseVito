import type { VitoTheme } from "../../hooks/useVitoTheme";
import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Swipeable from "react-native-gesture-handler/Swipeable";
import { useState, type ReactNode } from "react";
import { Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { MarkdownText } from "../../components/markdown/MarkdownText";
import { StructuredValue } from "../../components/StructuredValue";
import { useThemeStyles, useVitoTheme } from "../../hooks/useVitoTheme";
import { api } from "../../services/api/client";

export function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const value = block as Record<string, unknown>;
      if (typeof value.text === "string") return [value.text];
      if (typeof value.thinking === "string") return [];
      if (value.type === "tool_use" || value.type === "toolCall") {
        const input = value.input ?? value.arguments;
        return [
          `[tool call: ${String(value.name ?? "unknown")}]${input === undefined ? "" : `\n${pretty(input)}`}`,
        ];
      }
      if (value.type === "tool_result" || value.type === "toolResult")
        return [
          `[tool result] ${typeof value.content === "string" ? value.content : pretty(value.content)}`,
        ];
      return [];
    })
    .join("\n\n");
}

export function extractThinkingText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const thinking = (block as Record<string, unknown>).thinking;
      return typeof thinking === "string" ? [thinking] : [];
    })
    .join("\n\n");
}

export function PiSessionDeleteContainer({
  children,
  label,
  onDelete,
}: {
  children: ReactNode;
  label: string;
  onDelete: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  if (Platform.OS === "web")
    return (
      <View style={styles.desktopDeleteContainer}>
        {children}
        <Pressable
          accessibilityLabel={`Delete ${label}`}
          onPress={onDelete}
          style={styles.desktopDeleteButton}
        >
          <Ionicons name="trash-outline" size={16} color={theme.colors.danger} />
        </Pressable>
      </View>
    );
  return (
    <Swipeable
      containerStyle={styles.swipeContainer}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          accessibilityLabel={`Delete ${label}`}
          onPress={onDelete}
          style={styles.swipeDelete}
        >
          <Ionicons name="trash-outline" size={19} color="#fff" />
          <Text style={styles.swipeDeleteText}>Delete</Text>
        </Pressable>
      )}
    >
      {children}
    </Swipeable>
  );
}

export function StructuredRows({
  data,
  kind,
  showRaw = false,
  hideRawEvents = false,
}: {
  data: unknown;
  kind: "traces" | "pi";
  showRaw?: boolean;
  hideRawEvents?: boolean;
}) {
  const styles = useThemeStyles(createStyles);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const allLines =
    data && typeof data === "object" && Array.isArray((data as { lines?: unknown[] }).lines)
      ? (data as { lines: unknown[] }).lines
      : [];
  const lines = hideRawEvents
    ? allLines.filter(
        (line) =>
          !line || typeof line !== "object" || (line as { type?: unknown }).type !== "raw_event",
      )
    : allLines;
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <View style={styles.structuredList}>
      {lines.map((line, index) => {
        const record = (line ?? {}) as Record<string, unknown>;
        const type = String(record.type ?? "unknown");
        const rowKey = `${index}:main`;
        const isOpen = expanded.has(rowKey);
        let badge = type;
        let title = "";
        let body = "";
        let tint = styles.eventNeutral;
        let thoughtBody = "";

        if (kind === "pi" && type === "message") {
          const message = (record.message ?? {}) as Record<string, unknown>;
          const role = String(message.role ?? "message");
          const content = Array.isArray(message.content) ? message.content : [];
          const toolCalls = content.filter((block): block is Record<string, unknown> =>
            Boolean(
              block &&
              typeof block === "object" &&
              ((block as Record<string, unknown>).type === "toolCall" ||
                (block as Record<string, unknown>).type === "tool_use"),
            ),
          );
          const timestamp =
            typeof record.timestamp === "string"
              ? new Date(record.timestamp).toLocaleTimeString()
              : "";

          if (toolCalls.length) {
            badge = "tool call";
            title = toolCalls.map((call) => String(call.name ?? "unknown")).join(", ");
            tint = styles.eventTool;
          } else if (role === "toolResult" || role === "tool") {
            badge = "tool result";
            title = String(message.toolName ?? timestamp);
            tint = styles.eventTool;
          } else {
            badge = role;
            title = timestamp;
            tint = role === "user" ? styles.eventUser : styles.eventAssistant;
          }
          body = extractMessageText(message.content);
          thoughtBody = extractThinkingText(message.content);
        } else if (kind === "traces" && (type === "raw_event" || type === "normalized_event")) {
          const event = record.event;
          const eventRecord =
            event && typeof event === "object" ? (event as Record<string, unknown>) : {};
          badge = type === "raw_event" ? "raw" : "normalized";
          title = String(eventRecord.type ?? eventRecord.kind ?? "event");
          body = typeof event === "string" ? event : pretty(event);
          tint = type === "raw_event" ? styles.eventNeutral : styles.eventAssistant;
        } else if (type === "header" || type === "session") {
          title = String(record.model ?? record.id ?? record.session_id ?? "Session metadata");
          body = pretty(record);
        } else if (type === "user_message" || type === "prompt") {
          title = type === "user_message" ? "You" : "Prompt";
          body = String(record.content ?? "");
          tint = type === "user_message" ? styles.eventUser : styles.eventNeutral;
        } else if (type === "model_change") {
          title = `${String(record.provider ?? "")}/${String(record.modelId ?? "")}`;
          tint = styles.eventAssistant;
        } else if (type === "compaction" || type === "branch_summary") {
          title = String(record.summary ?? "").slice(0, 140);
          body = String(record.summary ?? "");
          tint = styles.eventTool;
        } else if (type === "footer") {
          title = `${String(record.duration_ms ?? 0)}ms · ${String(record.tool_calls ?? 0)} tool calls`;
          body = pretty(record);
          tint = record.success === false ? styles.eventError : styles.eventTool;
        } else {
          title = String(record.kind ?? record.name ?? record.timestamp ?? "Event");
          body = pretty(record);
        }

        const preview = body.replace(/\s+/g, " ").trim().slice(0, 180);
        const thoughtKey = `${index}:thought`;
        const thoughtOpen = expanded.has(thoughtKey);
        const thoughtPreview = thoughtBody.replace(/\s+/g, " ").trim().slice(0, 180);
        const showMain = Boolean(body) || !thoughtBody;
        return (
          <View key={`${type}-${index}`} style={styles.eventGroup}>
            {!!thoughtBody && (
              <Pressable
                onPress={() => toggle(thoughtKey)}
                style={[styles.eventCard, styles.eventThought]}
              >
                <View style={styles.eventHeader}>
                  <Text style={styles.eventBadge}>thought</Text>
                  <Text style={styles.eventTitle} numberOfLines={1}>
                    {thoughtPreview || "Reasoning"}
                  </Text>
                  <Text style={styles.eventChevron}>{thoughtOpen ? "▾" : "›"}</Text>
                </View>
                {!thoughtOpen && (
                  <Text style={styles.eventPreview} numberOfLines={2}>
                    {thoughtPreview}
                  </Text>
                )}
                {thoughtOpen && (
                  <Text selectable style={styles.eventBody}>
                    {thoughtBody}
                  </Text>
                )}
              </Pressable>
            )}
            {showMain && (
              <Pressable onPress={() => toggle(rowKey)} style={[styles.eventCard, tint]}>
                <View style={styles.eventHeader}>
                  <Text style={styles.eventBadge}>{badge}</Text>
                  <Text style={styles.eventTitle} numberOfLines={1}>
                    {title || preview || "Event"}
                  </Text>
                  <Text style={styles.eventChevron}>{isOpen ? "▾" : "›"}</Text>
                </View>
                {!isOpen && preview && (
                  <Text style={styles.eventPreview} numberOfLines={2}>
                    {preview}
                  </Text>
                )}
                {isOpen && (
                  <>
                    <View style={styles.eventBody}>
                      <StructuredValue value={body || record} rawValue={record} />
                    </View>
                    {showRaw && kind === "pi" && (
                      <Text selectable style={styles.eventRaw}>
                        {pretty(record)}
                      </Text>
                    )}
                  </>
                )}
              </Pressable>
            )}
          </View>
        );
      })}
      {lines.length === 0 && <Text style={styles.emptyText}>No rows in this page.</Text>}
    </View>
  );
}

export function humanize(key: string): string {
  return key
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function formatMemoryDay(value: unknown): string {
  if (typeof value !== "string") return "Unknown date";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toLocaleString();
  return pretty(value);
}

export function formatBytes(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StructuredDetail({ value }: { value: unknown }) {
  const styles = useThemeStyles(createStyles);
  if (typeof value === "string")
    return (
      <Text selectable style={styles.detailProse}>
        {value}
      </Text>
    );
  if (Array.isArray(value))
    return (
      <View style={styles.detailList}>
        {value.map((item, index) => (
          <View key={index} style={styles.detailGroup}>
            <Text style={styles.detailGroupTitle}>Item {index + 1}</Text>
            <StructuredDetail value={item} />
          </View>
        ))}
      </View>
    );
  if (!value || typeof value !== "object")
    return <Text style={styles.detailValue}>{displayValue(value)}</Text>;
  return (
    <View style={styles.fieldList}>
      {Object.entries(value as Record<string, unknown>).map(([key, field]) => {
        const complex = field !== null && typeof field === "object";
        return (
          <View key={key} style={complex ? styles.detailGroup : styles.fieldRow}>
            <Text style={complex ? styles.detailGroupTitle : styles.fieldLabel}>
              {humanize(key)}
            </Text>
            {complex ? (
              <StructuredDetail value={field} />
            ) : (
              <Text selectable style={styles.fieldValue}>
                {displayValue(field)}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

export function updatePath(value: unknown, path: string[], next: unknown): unknown {
  if (path.length === 0) return next;
  const [head, ...rest] = path;
  const object =
    value && typeof value === "object" && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  object[head] = updatePath(object[head], rest, next);
  return object;
}

export function ConfigFields({
  value,
  path = [],
  onUpdate,
}: {
  value: unknown;
  path?: string[];
  onUpdate: (path: string[], value: unknown) => void;
}) {
  const styles = useThemeStyles(createStyles);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return (
    <View style={styles.configFields}>
      {Object.entries(value as Record<string, unknown>).map(([key, field]) => {
        const fieldPath = [...path, key];
        if (field && typeof field === "object" && !Array.isArray(field))
          return (
            <View key={key} style={styles.configGroup}>
              <Text style={styles.configGroupTitle}>{humanize(key)}</Text>
              <ConfigFields value={field} path={fieldPath} onUpdate={onUpdate} />
            </View>
          );
        const serialized = Array.isArray(field) ? pretty(field) : String(field ?? "");
        return (
          <View key={key} style={styles.configField}>
            <Text style={styles.fieldLabel}>{humanize(key)}</Text>
            {typeof field === "boolean" ? (
              <Pressable
                onPress={() => onUpdate(fieldPath, !field)}
                style={[styles.booleanControl, field && styles.booleanControlOn]}
              >
                <Text style={styles.booleanText}>{field ? "On" : "Off"}</Text>
              </Pressable>
            ) : (
              <TextInput
                multiline={Array.isArray(field) || serialized.length > 80}
                value={serialized}
                onChangeText={(text) => {
                  let next: unknown = text;
                  if (
                    typeof field === "number" &&
                    text.trim() !== "" &&
                    Number.isFinite(Number(text))
                  )
                    next = Number(text);
                  else if (Array.isArray(field)) {
                    try {
                      next = JSON.parse(text);
                    } catch {
                      next = text;
                    }
                  }
                  onUpdate(fieldPath, next);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.input,
                  (Array.isArray(field) || serialized.length > 80) && styles.configMultiline,
                ]}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

export function StructuredConfigEditor({
  editor,
  onChange,
}: {
  editor: string;
  onChange: (value: string) => void;
}) {
  const styles = useThemeStyles(createStyles);
  let value: unknown;
  try {
    value = JSON.parse(editor);
  } catch {
    return (
      <Text style={styles.error}>
        Configuration is temporarily invalid. Correct user/vito.config.json and validate it.
      </Text>
    );
  }
  return (
    <ConfigFields
      value={value}
      onUpdate={(path, next) => onChange(pretty(updatePath(value, path, next)))}
    />
  );
}

export function MemoryOverview({ value }: { value: unknown }) {
  const styles = useThemeStyles(createStyles);
  const record = (value ?? {}) as Record<string, unknown>;
  const sessions = Array.isArray(record.sessions) ? record.sessions : [];
  return (
    <View>
      <View style={styles.memorySummary}>
        <Text style={styles.memorySummaryPrimary}>
          {displayValue(record.totalSessions)} sessions · {displayValue(record.totalChunks)}{" "}
          passages
        </Text>
        <Text style={styles.memorySummarySecondary}>
          {displayValue(record.totalDays)} days · {displayValue(record.oldestDay)} –{" "}
          {displayValue(record.newestDay)}
        </Text>
      </View>
      {sessions.length > 0 && (
        <View>
          <View style={styles.flatSectionHeader}>
            <Text style={styles.flatSectionTitle}>Recently indexed</Text>
          </View>
          {sessions.map((session, index) => {
            const row = session as Record<string, unknown>;
            return (
              <View key={String(row.session_id ?? index)} style={styles.flatRow}>
                <View style={styles.flatRowMain}>
                  <Text style={styles.cardTitle}>
                    {String(row.alias ?? row.session_id ?? "Session")}
                  </Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {`${displayValue(row.count)} passages · ${displayValue(row.first_day)} – ${displayValue(row.last_day)}`}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

export function labelFor(value: unknown, index: number): string {
  if (!value || typeof value !== "object") return String(value);
  const row = value as Record<string, unknown>;
  return String(
    row.name ??
      row.alias ??
      row.rel ??
      row.id ??
      row.filename ??
      row.path ??
      row.key ??
      row.provider ??
      `Item ${index + 1}`,
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    desktopDeleteContainer: {
      flex: 1,
      minWidth: 0,
      position: "relative",
      paddingRight: theme.space.xxl,
    },
    desktopDeleteButton: {
      position: "absolute",
      right: 0,
      bottom: 0,
      width: 28,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 6,
    },
    swipeContainer: { flex: 1, minWidth: 0 },
    swipeDelete: {
      width: 88,
      alignItems: "center",
      justifyContent: "center",
      gap: theme.space.xs,
      marginLeft: theme.space.sm,
      borderRadius: 10,
      backgroundColor: theme.colors.danger,
    },
    swipeDeleteText: { color: "#fff", fontSize: 11, fontWeight: "800" },
    structuredList: { gap: theme.space.sm },
    eventNeutral: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.separatorStrong,
    },
    eventTool: { backgroundColor: theme.colors.successSurface, borderColor: theme.colors.success },
    eventUser: { backgroundColor: theme.colors.infoSurface, borderColor: theme.colors.info },
    eventAssistant: { backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.info },
    eventError: { backgroundColor: theme.colors.dangerSurface, borderColor: theme.colors.danger },
    eventGroup: { gap: theme.space.sm },
    eventCard: { borderWidth: 1, borderRadius: 13, padding: theme.space.md },
    eventThought: { backgroundColor: theme.colors.surface, borderColor: theme.colors.accent },
    eventHeader: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
    eventBadge: {
      color: theme.colors.accent,
      backgroundColor: theme.colors.surfaceRaised,
      borderRadius: 7,
      overflow: "hidden",
      paddingHorizontal: theme.space.sm,
      paddingVertical: theme.space.xs,
      fontSize: 10,
      fontWeight: "800",
      fontFamily: "monospace",
    },
    eventTitle: {
      color: theme.colors.text,
      flex: 1,
      fontSize: 12,
      fontWeight: "700",
      fontFamily: "monospace",
    },
    eventChevron: { color: theme.colors.textMuted, fontSize: 18 },
    eventPreview: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      marginTop: theme.space.sm,
    },
    eventBody: {
      color: theme.colors.textSecondary,
      fontSize: 11,
      lineHeight: 17,
      marginTop: theme.space.md,
      fontFamily: "monospace",
    },
    eventRaw: {
      color: theme.colors.textMuted,
      fontSize: 10,
      lineHeight: 15,
      marginTop: theme.space.md,
      padding: theme.space.md,
      borderRadius: 8,
      backgroundColor: theme.colors.canvas,
      fontFamily: "monospace",
    },
    emptyText: { color: theme.colors.textMuted, textAlign: "center", padding: theme.space.xxl },
    detailProse: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      lineHeight: 22,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      borderRadius: 14,
      padding: theme.space.lg,
    },
    detailList: { gap: theme.space.md },
    detailGroup: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      borderRadius: 14,
      padding: theme.space.lg,
      marginTop: theme.space.sm,
    },
    detailGroupTitle: {
      color: theme.colors.accent,
      fontSize: 11,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: theme.space.sm,
    },
    detailValue: { color: theme.colors.textSecondary, fontSize: 14 },
    fieldList: { gap: theme.space.xxs },
    fieldRow: {
      paddingVertical: theme.space.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    fieldLabel: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginBottom: theme.space.xs,
    },
    fieldValue: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20 },
    configFields: { gap: theme.space.md },
    configGroup: {
      borderLeftWidth: 2,
      borderLeftColor: theme.colors.separatorStrong,
      paddingLeft: theme.space.md,
      marginTop: theme.space.sm,
    },
    configGroupTitle: {
      color: theme.colors.accent,
      fontSize: 14,
      fontWeight: "800",
      marginBottom: theme.space.md,
    },
    configField: { gap: theme.space.xs },
    booleanControl: {
      alignSelf: "flex-start",
      minWidth: 62,
      paddingHorizontal: theme.space.lg,
      paddingVertical: theme.space.sm,
      borderRadius: 16,
      backgroundColor: theme.colors.surfaceRaised,
    },
    booleanControlOn: { backgroundColor: theme.colors.accentSurface },
    booleanText: { color: theme.colors.text, fontSize: 12, fontWeight: "800", textAlign: "center" },
    input: {
      flex: 1,
      color: theme.colors.text,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      borderRadius: 12,
      padding: theme.space.md,
    },
    configMultiline: { minHeight: 90, textAlignVertical: "top" },
    error: { color: theme.colors.danger, marginVertical: theme.space.md },
    memorySummary: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      gap: theme.space.sm,
      paddingBottom: theme.space.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    memorySummaryPrimary: { color: theme.colors.text, fontSize: 12, fontWeight: "700" },
    memorySummarySecondary: { color: theme.colors.textMuted, fontSize: 11 },
    flatSectionHeader: {
      paddingTop: theme.space.xxxl,
      paddingBottom: theme.space.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    flatSectionTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "700" },
    flatRow: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.lg,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    flatRowMain: { flex: 1 },
    cardTitle: { color: theme.colors.text, fontWeight: "800", fontSize: 14 },
    cardMeta: { color: theme.colors.textMuted, fontSize: 12, marginTop: theme.space.xs },
  });
