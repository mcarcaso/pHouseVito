import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";
import Swipeable from "react-native-gesture-handler/Swipeable";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { api, VITO_URL } from "../../services/api/client";
import { MarkdownText } from "../../components/markdown/MarkdownText";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";
import { createOperationsStyles } from "./styles";

export type OperationArea =
  | "memory"
  | "profile"
  | "skills"
  | "jobs"
  | "apps"
  | "drive"
  | "traces"
  | "pi"
  | "settings"
  | "theme"
  | "secrets"
  | "system"
  | "server"
  | "providers";

export const operationAreas: Array<{ id: OperationArea; label: string; icon: string }> = [
  { id: "memory", label: "Memory", icon: "🧠" },
  { id: "profile", label: "Profile", icon: "◯" },
  { id: "skills", label: "Skills", icon: "🛠️" },
  { id: "jobs", label: "Jobs", icon: "⏰" },
  { id: "apps", label: "Apps", icon: "🚀" },
  { id: "drive", label: "Drive", icon: "📁" },
  { id: "traces", label: "Traces", icon: "🔍" },
  { id: "pi", label: "Pi sessions", icon: "🧵" },
  { id: "settings", label: "Settings", icon: "⚙️" },
  { id: "theme", label: "Theme", icon: "🎨" },
  { id: "secrets", label: "Secrets", icon: "🔑" },
  { id: "system", label: "System", icon: "📄" },
  { id: "server", label: "Server", icon: "🖥️" },
  { id: "providers", label: "Providers", icon: "🤖" },
];

const paths: Record<OperationArea, string> = {
  memory: "/api/memory/embeddings/stats",
  profile: "/api/memory/profile",
  skills: "/api/skills",
  jobs: "/api/cron/jobs",
  apps: "/api/apps",
  drive: "/api/drive/ls?path=",
  traces: "/api/logs?limit=100",
  pi: "/api/pi-sessions?includeContent=false",
  settings: "/api/config",
  theme: "/api/config",
  secrets: "/api/secrets",
  system: "/api/soul",
  server: "/api/server/status",
  providers: "/api/models/providers",
};

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function extractMessageText(content: unknown): string {
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

function extractThinkingText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const thinking = (block as Record<string, unknown>).thinking;
      return typeof thinking === "string" ? [thinking] : [];
    })
    .join("\n\n");
}

function PiSessionDeleteContainer({
  children,
  label,
  onDelete,
}: {
  children: ReactNode;
  label: string;
  onDelete: () => void;
}) {
  const styles = useThemeStyles(createOperationsStyles);
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

function StructuredRows({
  data,
  kind,
  showRaw = false,
}: {
  data: unknown;
  kind: "traces" | "pi";
  showRaw?: boolean;
}) {
  const styles = useThemeStyles(createOperationsStyles);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const lines =
    data && typeof data === "object" && Array.isArray((data as { lines?: unknown[] }).lines)
      ? (data as { lines: unknown[] }).lines
      : [];
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
          title = type === "user_message" ? "Mike" : "Prompt";
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
                    <Text selectable style={styles.eventBody}>
                      {body || pretty(record)}
                    </Text>
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

function humanize(key: string): string {
  return key
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatMemoryDay(value: unknown): string {
  if (typeof value !== "string") return "Unknown date";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toLocaleString();
  return pretty(value);
}

function formatBytes(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StructuredDetail({ value }: { value: unknown }) {
  const styles = useThemeStyles(createOperationsStyles);
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

function updatePath(value: unknown, path: string[], next: unknown): unknown {
  if (path.length === 0) return next;
  const [head, ...rest] = path;
  const object =
    value && typeof value === "object" && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  object[head] = updatePath(object[head], rest, next);
  return object;
}

function ConfigFields({
  value,
  path = [],
  onUpdate,
}: {
  value: unknown;
  path?: string[];
  onUpdate: (path: string[], value: unknown) => void;
}) {
  const styles = useThemeStyles(createOperationsStyles);
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

function StructuredConfigEditor({
  editor,
  onChange,
}: {
  editor: string;
  onChange: (value: string) => void;
}) {
  const styles = useThemeStyles(createOperationsStyles);
  let value: unknown;
  try {
    value = JSON.parse(editor);
  } catch {
    return (
      <Text style={styles.error}>
        Configuration is temporarily invalid. Correct it in the legacy dashboard.
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

function MemoryOverview({ value }: { value: unknown }) {
  const styles = useThemeStyles(createOperationsStyles);
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

function labelFor(value: unknown, index: number): string {
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

export function OperationsScreen({
  onUnauthorized,
  initialArea = "memory",
  showAreaTabs = true,
  onBack,
  onDetailOpen,
  onOpenStructuredDetail,
  onOpenItem,
  onOpenDriveDirectory,
  initialDetail,
  initialShowRaw = false,
  initialMemoryQuery,
  initialDrivePath = "",
  initialMemoryMode = "hybrid",
  initialMemoryLimit = 10,
  onMemorySearch,
  hideMemorySearch = false,
  hideScreenTitle = false,
  hideRefreshToolbar = false,
}: {
  onUnauthorized: () => void;
  initialArea?: OperationArea;
  showAreaTabs?: boolean;
  onBack?: () => void;
  onDetailOpen?: () => void;
  onOpenStructuredDetail?: (area: "traces" | "pi", id: string) => void;
  onOpenItem?: (area: "apps" | "providers", id: string) => void;
  onOpenDriveDirectory?: (path: string) => void;
  initialDetail?: { area: "traces" | "pi"; id: string };
  initialShowRaw?: boolean;
  initialMemoryQuery?: string;
  initialDrivePath?: string;
  initialMemoryMode?: "hybrid" | "embedding" | "bm25";
  initialMemoryLimit?: number;
  onMemorySearch?: (query: string, mode: "hybrid" | "embedding" | "bm25", limit: number) => void;
  hideMemorySearch?: boolean;
  hideScreenTitle?: boolean;
  hideRefreshToolbar?: boolean;
}) {
  const styles = useThemeStyles(createOperationsStyles);
  const theme = useVitoTheme();
  const [area, setArea] = useState<OperationArea>(initialArea);
  const [data, setData] = useState<unknown>();
  const [selected, setSelected] = useState<unknown>();
  const [detailTarget, setDetailTarget] = useState<{
    area: "traces" | "pi";
    id: string;
    offset: number;
  } | null>(initialDetail ? { ...initialDetail, offset: 0 } : null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [hasOlderDetailRows, setHasOlderDetailRows] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialMemoryQuery ?? "");
  const [memoryMode, setMemoryMode] = useState<"hybrid" | "embedding" | "bm25">(initialMemoryMode);
  const [memoryLimit, setMemoryLimit] = useState(String(initialMemoryLimit));
  const [showMemoryAdvanced, setShowMemoryAdvanced] = useState(false);
  const [showPiRaw, setShowPiRaw] = useState(initialShowRaw);
  const [editor, setEditor] = useState("");
  const [drivePath, setDrivePath] = useState(initialDrivePath);
  const [command, setCommand] = useState("");
  const [siteFolder, setSiteFolder] = useState("");
  const [providerPrompt, setProviderPrompt] = useState("");
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [editingJob, setEditingJob] = useState<string | null>(null);
  const [expandedMemory, setExpandedMemory] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected(undefined);
    try {
      if (area === "memory" && !initialMemoryQuery) {
        setData(undefined);
        return;
      }
      const path =
        area === "memory" && initialMemoryQuery
          ? `/api/memory/embeddings/search?q=${encodeURIComponent(initialMemoryQuery)}&mode=${memoryMode}&limit=${Math.max(1, Math.min(50, Number(memoryLimit) || 10))}`
          : area === "drive"
            ? `/api/drive/ls?path=${encodeURIComponent(drivePath)}`
            : paths[area];
      const result = await api<unknown>(path);
      setData(result);
      if (area === "settings") setEditor(pretty(result));
      if (area === "system") {
        const content = (result as { content?: unknown })?.content;
        setEditor(typeof content === "string" ? content : "");
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Request failed";
      if (message.toLowerCase().includes("unauthorized")) onUnauthorized();
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [area, drivePath, initialMemoryQuery, memoryLimit, memoryMode, onUnauthorized]);

  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (selected !== undefined || detailTarget !== null) onDetailOpen?.();
  }, [detailTarget, onDetailOpen, selected]);

  const mutate = async (path: string, method: string, body?: unknown) => {
    setLoading(true);
    setError(null);
    try {
      await api(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed");
      setLoading(false);
    }
  };

  const confirm = (title: string, action: () => void) =>
    Alert.alert(title, "This action changes Vito. Continue?", [
      { text: "Cancel", style: "cancel" },
      { text: "Continue", style: "destructive", onPress: action },
    ]);

  const searchMemory = async () => {
    if (!query.trim()) return;
    const limit = Math.max(1, Math.min(50, Number(memoryLimit) || 10));
    if (onMemorySearch) {
      onMemorySearch(query.trim(), memoryMode, limit);
      return;
    }
    setLoading(true);
    try {
      setData(
        await api(
          `/api/memory/embeddings/search?q=${encodeURIComponent(query.trim())}&mode=${memoryMode}&limit=${limit}`,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const rowIdentifier = (row: unknown, index: number): string => {
    const record = (row ?? {}) as Record<string, unknown>;
    if (area === "traces" && typeof record.filename === "string") return record.filename;
    if (area === "pi" && typeof record.rel === "string") return record.rel;
    if (area === "secrets" && typeof record.key === "string") return record.key;
    if (area === "providers" && typeof record.id === "string") return record.id;
    return labelFor(row, index);
  };

  const loadDetailPage = async (
    target: { area: "traces" | "pi"; id: string; offset: number },
    prepend = false,
  ) => {
    setDetailTarget(target);
    setDetailLoading(true);
    setError(null);
    try {
      const encoded =
        target.area === "traces"
          ? encodeURIComponent(target.id)
          : target.id.split("/").map(encodeURIComponent).join("/");
      const page = await api<{ lines?: unknown[] }>(
        `/api/${target.area === "traces" ? "logs" : "pi-sessions"}/${encoded}?offset=${target.offset}&limit=50&order=newest`,
      );
      setHasOlderDetailRows((page.lines?.length ?? 0) === 50);
      if (prepend) {
        setSelected((current: unknown) => {
          const currentLines =
            current &&
            typeof current === "object" &&
            Array.isArray((current as { lines?: unknown[] }).lines)
              ? (current as { lines: unknown[] }).lines
              : [];
          return { ...page, lines: [...(page.lines ?? []), ...currentLines] };
        });
      } else setSelected(page);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load details");
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => setShowPiRaw(initialShowRaw), [initialShowRaw]);

  useEffect(() => {
    if (initialDetail) void loadDetailPage({ ...initialDetail, offset: 0 });
    // The route owns changes to the initial detail identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDetail?.area, initialDetail?.id]);

  const openRow = async (row: unknown, index: number) => {
    const name = rowIdentifier(row, index);
    setError(null);
    if (area === "traces" || area === "pi") {
      if (onOpenStructuredDetail) onOpenStructuredDetail(area, name);
      else await loadDetailPage({ area, id: name, offset: 0 });
      return;
    }
    if ((area === "apps" || area === "providers") && onOpenItem) {
      onOpenItem(area, name);
      return;
    }
    setDetailLoading(true);
    try {
      if (area === "skills")
        setSelected(await api(`/api/skills/${encodeURIComponent(name)}/files`));
      else if (area === "providers")
        setSelected(
          await api(
            `/api/models/${encodeURIComponent(String((row as { id?: unknown }).id ?? name))}`,
          ),
        );
      else if (area === "apps")
        setSelected(await api(`/api/apps/${encodeURIComponent(name)}/files`));
      else setSelected(row);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load details");
    } finally {
      setDetailLoading(false);
    }
  };

  const runCommand = () => {
    try {
      const value = JSON.parse(command) as unknown;
      if (area === "jobs") {
        void mutate(
          editingJob ? `/api/cron/jobs/${encodeURIComponent(editingJob)}` : "/api/cron/jobs",
          editingJob ? "PUT" : "POST",
          value,
        );
        setEditingJob(null);
      } else if (area === "settings") void mutate("/api/config", "PUT", value);
      setCommand("");
    } catch {
      setError("The command must be valid JSON");
    }
  };

  const uploadDriveFile = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: siteFolder.trim() ? "application/zip" : "*/*",
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    let base64: string;
    if (asset.file) {
      base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("Could not read file"));
        reader.readAsDataURL(asset.file as Blob);
      });
    } else {
      base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }
    const data = `data:${asset.mimeType ?? "application/octet-stream"};base64,${base64}`;
    if (siteFolder.trim()) {
      const folder = [drivePath, siteFolder.trim()].filter(Boolean).join("/");
      await mutate("/api/drive/upload-site", "POST", { data, folder });
    } else {
      await mutate("/api/drive/upload", "POST", {
        data,
        filename: asset.name,
        folder: drivePath || undefined,
      });
    }
  };

  const saveEditor = () => {
    if (area === "settings") {
      try {
        void mutate("/api/config", "PUT", JSON.parse(editor));
      } catch {
        setError("Settings must be valid JSON");
      }
    } else if (area === "system") void mutate("/api/soul", "PUT", { content: editor });
  };

  const providerRows =
    area === "providers" && data && typeof data === "object"
      ? ((data as { oauthProviders?: unknown[] }).oauthProviders ?? [])
      : null;
  const driveRows =
    area === "drive" && data && typeof data === "object"
      ? [
          ...(((data as { dirs?: unknown[] }).dirs ?? []).map((entry) => ({
            ...(entry as object),
            path: [drivePath, (entry as { name: string }).name].filter(Boolean).join("/"),
            isDir: true,
          })) as unknown[]),
          ...(((data as { files?: unknown[] }).files ?? []).map((entry) => ({
            ...(entry as object),
            path: [drivePath, (entry as { name: string }).name].filter(Boolean).join("/"),
            isDir: false,
          })) as unknown[]),
        ]
      : null;
  const rows =
    providerRows ??
    driveRows ??
    (Array.isArray(data)
      ? data
      : data && typeof data === "object" && Array.isArray((data as { files?: unknown[] }).files)
        ? (data as { files: unknown[] }).files
        : data &&
            typeof data === "object" &&
            "results" in data &&
            Array.isArray((data as { results: unknown[] }).results)
          ? (data as { results: unknown[] }).results
          : null);

  if (detailTarget) {
    return (
      <View style={styles.root}>
        {!initialDetail && (
          <View style={styles.titleRow}>
            <Pressable
              onPress={() => {
                setSelected(undefined);
                setDetailTarget(null);
                setError(null);
              }}
              style={styles.backButton}
            >
              <Text style={styles.backText}>‹</Text>
            </Pressable>
            <View style={styles.detailHeading}>
              <Text style={styles.title}>
                {detailTarget.area === "traces" ? "Trace details" : "Pi session"}
              </Text>
              <Text style={styles.detailId} numberOfLines={1}>
                {detailTarget.id}
              </Text>
            </View>
            {detailTarget.area === "pi" && (
              <Pressable
                onPress={() => setShowPiRaw((value) => !value)}
                style={[styles.rawToggle, showPiRaw && styles.rawToggleActive]}
              >
                <Text style={[styles.rawToggleText, showPiRaw && styles.rawToggleTextActive]}>
                  RAW
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}
        {detailLoading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={styles.loadingText}>Loading selected rows…</Text>
          </View>
        )}

        {hasOlderDetailRows && selected !== undefined && (
          <View style={styles.loadMoreSeparator}>
            <View style={styles.loadMoreRule} />
            <Pressable
              disabled={detailLoading}
              onPress={() =>
                void loadDetailPage({ ...detailTarget, offset: detailTarget.offset + 50 }, true)
              }
              style={styles.loadMoreButton}
            >
              <Text style={styles.loadMoreText}>
                {detailLoading ? "Loading…" : "Load 50 older rows"}
              </Text>
            </Pressable>
            <View style={styles.loadMoreRule} />
          </View>
        )}

        {selected !== undefined && (
          <StructuredRows data={selected} kind={detailTarget.area} showRaw={showPiRaw} />
        )}
      </View>
    );
  }

  if (selected !== undefined) {
    return (
      <View style={styles.root}>
        <View style={styles.titleRow}>
          <Pressable
            onPress={() => {
              setSelected(undefined);
              setError(null);
            }}
            style={styles.backButton}
          >
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <Text style={styles.title}>Details</Text>
        </View>
        <StructuredDetail value={selected} />
      </View>
    );
  }

  if (area === "memory" && !initialMemoryQuery) {
    return (
      <View style={[styles.root, styles.memoryRoot, styles.memoryLanding]}>
        <Text style={styles.memoryLandingTitle}>Search memory</Text>
        <Text style={styles.memoryLandingSubtitle}>Find conversations by meaning or keyword.</Text>
        <View style={styles.memoryLandingSearch}>
          <Text style={styles.memorySearchIcon}>⌕</Text>
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void searchMemory()}
            placeholder="What do you want to remember?"
            placeholderTextColor={theme.colors.textMuted}
            returnKeyType="search"
            style={styles.memorySearchInput}
          />
          <Pressable onPress={() => void searchMemory()} style={styles.memorySearchButton}>
            <Text style={styles.memorySearchButtonText}>Search</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => setShowMemoryAdvanced((value) => !value)}>
          <Text style={styles.memoryAdvancedToggle}>
            {showMemoryAdvanced ? "Hide advanced" : "Advanced"}
          </Text>
        </Pressable>
        {showMemoryAdvanced && (
          <View style={styles.memoryAdvancedPanel}>
            <View style={styles.memoryModeRow}>
              {(["hybrid", "embedding", "bm25"] as const).map((mode) => (
                <Pressable
                  key={mode}
                  onPress={() => setMemoryMode(mode)}
                  style={[
                    styles.memoryModeButton,
                    memoryMode === mode && styles.memoryModeButtonActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.memoryModeText,
                      memoryMode === mode && styles.memoryModeTextActive,
                    ]}
                  >
                    {mode === "bm25" ? "BM25" : mode[0].toUpperCase() + mode.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.memoryLimitRow}>
              <Text style={styles.memoryLimitLabel}>Result limit</Text>
              <TextInput
                value={memoryLimit}
                onChangeText={setMemoryLimit}
                keyboardType="number-pad"
                style={styles.memoryLimitInput}
              />
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.root, area === "memory" && styles.memoryRoot]}>
      {!hideScreenTitle && (area !== "memory" || onBack) && (
        <View style={[styles.titleRow, onBack && styles.compactTitleRow]}>
          {onBack && (
            <Pressable onPress={onBack} style={styles.backButton}>
              <Text style={styles.backText}>‹</Text>
            </Pressable>
          )}
          {area !== "memory" && !onBack && (
            <Text style={[styles.title, styles.screenTitle]}>
              {showAreaTabs
                ? "Run the family business."
                : operationAreas.find((item) => item.id === area)?.label}
            </Text>
          )}
        </View>
      )}
      {showAreaTabs && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>
          <View style={styles.tabRow}>
            {operationAreas.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  setArea(item.id);
                  setDrivePath("");
                }}
                style={[styles.tab, area === item.id && styles.tabActive]}
              >
                <Text style={[styles.tabText, area === item.id && styles.tabTextActive]}>
                  {item.icon} {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}

      {!hideRefreshToolbar && area !== "memory" && area !== "profile" && (
        <View style={styles.toolbar}>
          <View />
          <Pressable
            accessibilityLabel="Refresh"
            onPress={() => void load()}
            style={area === "pi" ? styles.iconButton : styles.smallButton}
          >
            {area === "pi" ? (
              <Ionicons name="refresh" size={18} color={theme.colors.textSecondary} />
            ) : (
              <Text style={styles.smallButtonText}>Refresh</Text>
            )}
          </Pressable>
        </View>
      )}

      {area === "memory" && !initialMemoryQuery && !hideMemorySearch && (
        <View style={styles.memorySearchRow}>
          <Text style={styles.memorySearchIcon}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void searchMemory()}
            placeholder="Search memory"
            placeholderTextColor={theme.colors.textMuted}
            returnKeyType="search"
            style={styles.memorySearchInput}
          />
        </View>
      )}

      {area === "providers" && activeProvider && (
        <View style={styles.editorBlock}>
          <TextInput
            value={providerPrompt}
            onChangeText={setProviderPrompt}
            placeholder="OAuth prompt or authorization code"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.input}
          />
          <View style={styles.formRow}>
            <Pressable
              onPress={() =>
                void mutate(
                  `/api/auth/provider/${encodeURIComponent(activeProvider)}/login/prompt`,
                  "POST",
                  { value: providerPrompt },
                )
              }
              style={styles.smallButton}
            >
              <Text style={styles.smallButtonText}>Submit prompt</Text>
            </Pressable>
            <Pressable
              onPress={async () =>
                setSelected(
                  await api(
                    `/api/auth/provider/${encodeURIComponent(activeProvider)}/login/status`,
                  ),
                )
              }
              style={styles.smallButton}
            >
              <Text style={styles.smallButtonText}>Check login</Text>
            </Pressable>
          </View>
        </View>
      )}

      {area === "jobs" && (
        <View style={styles.editorBlock}>
          <TextInput
            multiline
            value={command}
            onChangeText={setCommand}
            placeholder='New job JSON, e.g. {"name":"...","schedule":"...","prompt":"...","session":"dashboard:default"}'
            placeholderTextColor={theme.colors.textMuted}
            style={[styles.input, styles.commandEditor]}
          />
          <Pressable onPress={runCommand} style={styles.primaryButton}>
            <Text style={styles.primaryText}>
              {editingJob ? `Update ${editingJob}` : "Create job"}
            </Text>
          </Pressable>
        </View>
      )}

      {area === "drive" && (
        <View style={styles.formRow}>
          <TextInput
            value={drivePath}
            onChangeText={setDrivePath}
            placeholder="Drive path"
            placeholderTextColor={theme.colors.textMuted}
            style={styles.input}
          />
          <Pressable onPress={() => void load()} style={styles.smallButton}>
            <Text style={styles.smallButtonText}>Open</Text>
          </Pressable>
          <Pressable onPress={() => void uploadDriveFile()} style={styles.smallButton}>
            <Text style={styles.smallButtonText}>Upload</Text>
          </Pressable>
        </View>
      )}
      {area === "drive" && (
        <TextInput
          value={siteFolder}
          onChangeText={setSiteFolder}
          placeholder="Optional site folder (selects a ZIP)"
          placeholderTextColor={theme.colors.textMuted}
          style={[styles.input, styles.driveFolder]}
        />
      )}

      {(area === "settings" || area === "system") && (
        <View style={styles.editorBlock}>
          {area === "settings" ? (
            <StructuredConfigEditor editor={editor} onChange={setEditor} />
          ) : (
            <TextInput
              multiline
              value={editor}
              onChangeText={setEditor}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, styles.editor]}
            />
          )}
          <Pressable onPress={saveEditor} style={styles.primaryButton}>
            <Text style={styles.primaryText}>
              Save {area === "settings" ? "settings" : "SOUL.md"}
            </Text>
          </Pressable>
          {area === "system" && (
            <Pressable
              onPress={async () => setSelected(await api("/api/system-prompt"))}
              style={styles.smallButton}
            >
              <Text style={styles.smallButtonText}>View read-only system prompt</Text>
            </Pressable>
          )}
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
      {(loading || detailLoading) && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.loadingText}>
            {detailLoading ? "Loading selected rows…" : "Loading…"}
          </Text>
        </View>
      )}

      {!loading && area === "server" && (
        <View style={styles.actionRow}>
          <Pressable
            onPress={() =>
              confirm("Rebuild and restart Vito", () => void mutate("/api/server/restart", "POST"))
            }
            style={styles.dangerButton}
          >
            <Text style={styles.dangerText}>Rebuild & restart</Text>
          </Pressable>
        </View>
      )}

      {!loading && area === "memory" && rows && (
        <Text style={styles.resultCount}>
          {rows.length} {rows.length === 1 ? "result" : "results"}
        </Text>
      )}

      {!loading && rows && (
        <View style={styles.list}>
          {rows.map((row, index) => {
            const record = (row ?? {}) as Record<string, unknown>;
            const name = labelFor(row, index);
            const identifier = rowIdentifier(row, index);
            const memoryResult = area === "memory" && typeof record.text === "string";
            const piSession = area === "pi" && typeof record.rel === "string";
            const title = memoryResult ? String(record.alias ?? record.session_id ?? name) : name;
            const context = memoryResult ? displayValue(record.context) : "";
            const memoryKey = String(record.id ?? `${record.session_id ?? "memory"}-${index}`);
            const memoryExpanded = memoryResult && expandedMemory.has(memoryKey);
            return (
              <View
                key={`${name}-${index}`}
                style={[styles.card, memoryResult && styles.memoryResultRow]}
              >
                {piSession ? (
                  <PiSessionDeleteContainer
                    label={name}
                    onDelete={() =>
                      confirm(
                        `Delete ${name}`,
                        () =>
                          void mutate(
                            `/api/pi-sessions/${identifier.split("/").map(encodeURIComponent).join("/")}`,
                            "DELETE",
                          ),
                      )
                    }
                  >
                    <Pressable
                      onPress={() => void openRow(row, index)}
                      style={styles.piSessionMain}
                    >
                      <View style={styles.piSessionTop}>
                        <Text style={styles.piSessionTitle} numberOfLines={1}>
                          {String(record.alias || record.vitoSessionId || record.rel)}
                        </Text>
                        <Text style={styles.piSessionDate}>
                          {new Date(Number(record.mtime)).toLocaleString()}
                        </Text>
                      </View>
                      <View style={styles.piSessionMeta}>
                        {!!record.lastModel && (
                          <Text
                            style={[styles.piSessionTag, styles.piSessionModel]}
                            numberOfLines={1}
                          >
                            {String(record.lastModel)}
                          </Text>
                        )}
                        {record.messageCount !== null && record.messageCount !== undefined && (
                          <Text style={styles.piSessionTag}>
                            {String(record.messageCount)} messages
                          </Text>
                        )}
                        <Text style={styles.piSessionSize}>{formatBytes(record.size)}</Text>
                      </View>
                      {!!record.alias && !!record.vitoSessionId && (
                        <Text style={styles.piSessionId} numberOfLines={1}>
                          {String(record.vitoSessionId)}
                        </Text>
                      )}
                      {!!record.lastUserMessage && (
                        <Text style={styles.piSessionPreview} numberOfLines={2}>
                          {String(record.lastUserMessage)}
                        </Text>
                      )}
                    </Pressable>
                  </PiSessionDeleteContainer>
                ) : memoryResult ? (
                  <View style={styles.cardMain}>
                    <View style={styles.memoryHeader}>
                      <View style={styles.memoryIdentity}>
                        <Text style={styles.memoryDay}>{formatMemoryDay(record.day)}</Text>
                        <Text style={styles.memorySession} numberOfLines={1}>
                          {title || name}
                        </Text>
                      </View>
                      <Pressable
                        accessibilityLabel={
                          memoryExpanded ? "Collapse conversation" : "Expand conversation"
                        }
                        onPress={() =>
                          setExpandedMemory((current) => {
                            const next = new Set(current);
                            if (next.has(memoryKey)) next.delete(memoryKey);
                            else next.add(memoryKey);
                            return next;
                          })
                        }
                        style={styles.memoryExpandButton}
                      >
                        <Text style={styles.memoryExpandIcon}>{memoryExpanded ? "−" : "+"}</Text>
                      </Pressable>
                    </View>
                    {context && context !== "—" && (
                      <Text selectable style={styles.memoryContext} numberOfLines={3}>
                        {context}
                      </Text>
                    )}
                    <View style={styles.memoryScores}>
                      {Number(record.rrfScore) > 0 && (
                        <Text style={[styles.memoryScore, styles.memoryScoreRrf]}>
                          RRF {Number(record.rrfScore).toFixed(4)}
                        </Text>
                      )}
                      {Number(record.embeddingScore) > 0 && (
                        <Text style={[styles.memoryScore, styles.memoryScoreEmbedding]}>
                          EMB {Number(record.embeddingScore).toFixed(3)}
                        </Text>
                      )}
                      {Number(record.recencyFactor) > 0 && Number(record.recencyFactor) < 1 && (
                        <Text style={[styles.memoryScore, styles.memoryScoreDecay]}>
                          ×{Number(record.recencyFactor).toFixed(2)} decay
                        </Text>
                      )}
                      {Number(record.bm25Score) > 0 && (
                        <Text style={[styles.memoryScore, styles.memoryScoreBm25]}>
                          BM25 {Number(record.bm25Score).toFixed(2)}
                        </Text>
                      )}
                    </View>
                    {memoryExpanded && (
                      <View style={styles.memoryExpansion}>
                        <Text style={styles.memoryExpansionLabel}>Matching conversation</Text>
                        <Text selectable style={styles.memoryExpansionText}>
                          {String(record.text)}
                        </Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <Pressable onPress={() => void openRow(row, index)} style={styles.cardMain}>
                    <Text style={styles.cardTitle}>{title || name}</Text>
                    <Text style={styles.cardMeta} numberOfLines={2}>
                      {String(
                        record.description ??
                          record.status ??
                          record.day ??
                          record.channel ??
                          record.type ??
                          "View details",
                      )}
                    </Text>
                  </Pressable>
                )}
                {area === "apps" && (
                  <View style={styles.inlineActions}>
                    {(["start", "stop", "restart"] as const).map((action) => (
                      <Pressable
                        key={action}
                        onPress={() =>
                          void mutate(`/api/apps/${encodeURIComponent(name)}/${action}`, "POST")
                        }
                      >
                        <Text style={styles.link}>{action}</Text>
                      </Pressable>
                    ))}
                    <Pressable
                      onPress={() =>
                        confirm(
                          `Delete ${name}`,
                          () => void mutate(`/api/apps/${encodeURIComponent(name)}`, "DELETE"),
                        )
                      }
                    >
                      <Text style={styles.deleteLink}>delete</Text>
                    </Pressable>
                  </View>
                )}
                {area === "providers" && (
                  <View style={styles.inlineActions}>
                    <Pressable
                      onPress={async () => {
                        const id = String(record.id ?? name);
                        try {
                          setActiveProvider(id);
                          const result = await api<Record<string, unknown>>(
                            `/api/auth/provider/${encodeURIComponent(id)}/login`,
                            { method: "POST" },
                          );
                          const url =
                            typeof result.url === "string"
                              ? result.url
                              : typeof result.verificationUri === "string"
                                ? result.verificationUri
                                : null;
                          if (url) await Linking.openURL(url);
                        } catch (cause) {
                          setError(cause instanceof Error ? cause.message : "Login failed");
                        }
                      }}
                    >
                      <Text style={styles.link}>login</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        confirm(
                          `Log out ${name}`,
                          () =>
                            void mutate(
                              `/api/auth/provider/${encodeURIComponent(String(record.id ?? name))}/logout`,
                              "POST",
                            ),
                        )
                      }
                    >
                      <Text style={styles.deleteLink}>logout</Text>
                    </Pressable>
                  </View>
                )}
                {area === "jobs" && (
                  <View style={styles.inlineActions}>
                    <Pressable
                      onPress={() => {
                        setEditingJob(name);
                        setCommand(pretty(row));
                      }}
                    >
                      <Text style={styles.link}>edit</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        void mutate(`/api/cron/jobs/${encodeURIComponent(name)}/trigger`, "POST")
                      }
                    >
                      <Text style={styles.link}>run now</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        confirm(
                          `Delete ${name}`,
                          () => void mutate(`/api/cron/jobs/${encodeURIComponent(name)}`, "DELETE"),
                        )
                      }
                    >
                      <Text style={styles.deleteLink}>delete</Text>
                    </Pressable>
                  </View>
                )}
                {area === "traces" && (
                  <Pressable
                    onPress={() =>
                      confirm(
                        `Delete ${name}`,
                        () =>
                          void mutate(
                            area === "traces"
                              ? `/api/logs/${encodeURIComponent(identifier)}`
                              : `/api/pi-sessions/${identifier.split("/").map(encodeURIComponent).join("/")}`,
                            "DELETE",
                          ),
                      )
                    }
                  >
                    <Text style={styles.deleteLink}>delete</Text>
                  </Pressable>
                )}
                {area === "drive" && typeof record.path === "string" && (
                  <View style={styles.inlineActions}>
                    <Pressable
                      onPress={() =>
                        record.isDirectory === true || record.isDir === true
                          ? onOpenDriveDirectory
                            ? onOpenDriveDirectory(record.path as string)
                            : setDrivePath(record.path as string)
                          : void Linking.openURL(`${VITO_URL}/api/drive/file/${record.path}`)
                      }
                    >
                      <Text style={styles.link}>open</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        void mutate(
                          `/api/drive/${record.isDir === true ? "meta" : "file-meta"}?path=${encodeURIComponent(record.path as string)}`,
                          "PUT",
                          { isPublic: record.isPublic !== true },
                        )
                      }
                    >
                      <Text style={styles.link}>
                        {record.isPublic === true ? "private" : "public"}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        confirm(
                          `Delete ${name}`,
                          () =>
                            void mutate(
                              `/api/drive?path=${encodeURIComponent(record.path as string)}`,
                              "DELETE",
                            ),
                        )
                      }
                    >
                      <Text style={styles.deleteLink}>delete</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      {!loading && !rows && area === "memory" && <MemoryOverview value={data} />}
      {!loading &&
        area === "profile" &&
        data !== null &&
        data !== undefined &&
        typeof data === "object" && (
          <MarkdownText>{String((data as { content?: unknown }).content ?? "")}</MarkdownText>
        )}
      {!loading &&
        !rows &&
        area !== "memory" &&
        area !== "profile" &&
        area !== "settings" &&
        area !== "system" && <StructuredDetail value={data} />}
    </View>
  );
}
