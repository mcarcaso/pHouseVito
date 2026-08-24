import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api, VITO_URL } from "./api";

export type OperationArea =
  | "memory"
  | "skills"
  | "jobs"
  | "apps"
  | "drive"
  | "traces"
  | "pi"
  | "settings"
  | "secrets"
  | "system"
  | "server"
  | "providers";

export const operationAreas: Array<{ id: OperationArea; label: string; icon: string }> = [
  { id: "memory", label: "Memory", icon: "🧠" },
  { id: "skills", label: "Skills", icon: "🛠️" },
  { id: "jobs", label: "Jobs", icon: "⏰" },
  { id: "apps", label: "Apps", icon: "🚀" },
  { id: "drive", label: "Drive", icon: "📁" },
  { id: "traces", label: "Traces", icon: "🔍" },
  { id: "pi", label: "Pi sessions", icon: "🧵" },
  { id: "settings", label: "Settings", icon: "⚙️" },
  { id: "secrets", label: "Secrets", icon: "🔑" },
  { id: "system", label: "System", icon: "📄" },
  { id: "server", label: "Server", icon: "🖥️" },
  { id: "providers", label: "Providers", icon: "🤖" },
];

const paths: Record<OperationArea, string> = {
  memory: "/api/memory/embeddings/stats",
  skills: "/api/skills",
  jobs: "/api/cron/jobs",
  apps: "/api/apps",
  drive: "/api/drive/ls?path=",
  traces: "/api/logs?limit=100",
  pi: "/api/pi-sessions?includeContent=false",
  settings: "/api/config",
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
      if (typeof value.thinking === "string") return [value.thinking];
      if (value.type === "tool_use") return [`[tool: ${String(value.name ?? "unknown")}]`];
      if (value.type === "tool_result")
        return [`[tool result] ${typeof value.content === "string" ? value.content : ""}`];
      return [];
    })
    .join("\n\n");
}

function StructuredRows({ data, kind }: { data: unknown; kind: "traces" | "pi" }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const lines =
    data && typeof data === "object" && Array.isArray((data as { lines?: unknown[] }).lines)
      ? (data as { lines: unknown[] }).lines
      : [];
  const toggle = (index: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <View style={styles.structuredList}>
      {lines.map((line, index) => {
        const record = (line ?? {}) as Record<string, unknown>;
        const type = String(record.type ?? "unknown");
        const isOpen = expanded.has(index);
        let badge = type;
        let title = "";
        let body = "";
        let tint = styles.eventNeutral;

        if (kind === "pi" && type === "message") {
          const message = (record.message ?? {}) as Record<string, unknown>;
          badge = String(message.role ?? "message");
          title =
            typeof record.timestamp === "string"
              ? new Date(record.timestamp).toLocaleTimeString()
              : "";
          body = extractMessageText(message.content);
          tint =
            badge === "user"
              ? styles.eventUser
              : badge === "assistant"
                ? styles.eventAssistant
                : styles.eventTool;
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
        return (
          <Pressable
            key={`${type}-${index}`}
            onPress={() => toggle(index)}
            style={[styles.eventCard, tint]}
          >
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
              <Text selectable style={styles.eventBody}>
                {body || pretty(record)}
              </Text>
            )}
          </Pressable>
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

function StructuredDetail({ value }: { value: unknown }) {
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
            <Text style={styles.flatSectionTitle}>Recent sessions</Text>
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
                <Text style={styles.flatChevron}>›</Text>
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
  initialMemoryQuery,
  onMemorySearch,
}: {
  onUnauthorized: () => void;
  initialArea?: OperationArea;
  showAreaTabs?: boolean;
  onBack?: () => void;
  onDetailOpen?: () => void;
  initialMemoryQuery?: string;
  onMemorySearch?: (query: string) => void;
}) {
  const [area, setArea] = useState<OperationArea>(initialArea);
  const [data, setData] = useState<unknown>();
  const [selected, setSelected] = useState<unknown>();
  const [detailTarget, setDetailTarget] = useState<{
    area: "traces" | "pi";
    id: string;
    offset: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialMemoryQuery ?? "");
  const [editor, setEditor] = useState("");
  const [drivePath, setDrivePath] = useState("");
  const [command, setCommand] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [secretValue, setSecretValue] = useState("");
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
      const path =
        area === "memory" && initialMemoryQuery
          ? `/api/memory/embeddings/search?q=${encodeURIComponent(initialMemoryQuery)}&mode=hybrid&limit=10`
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
  }, [area, drivePath, initialMemoryQuery, onUnauthorized]);

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
    if (onMemorySearch) {
      onMemorySearch(query.trim());
      return;
    }
    setLoading(true);
    try {
      setData(
        await api(
          `/api/memory/embeddings/search?q=${encodeURIComponent(query.trim())}&mode=hybrid&limit=10`,
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

  const loadDetailPage = async (target: { area: "traces" | "pi"; id: string; offset: number }) => {
    setDetailTarget(target);
    setDetailLoading(true);
    setError(null);
    try {
      const encoded =
        target.area === "traces"
          ? encodeURIComponent(target.id)
          : target.id.split("/").map(encodeURIComponent).join("/");
      setSelected(
        await api(
          `/api/${target.area === "traces" ? "logs" : "pi-sessions"}/${encoded}?offset=${target.offset}&limit=50&order=newest`,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load details");
    } finally {
      setDetailLoading(false);
    }
  };

  const openRow = async (row: unknown, index: number) => {
    const name = rowIdentifier(row, index);
    setError(null);
    if (area === "traces" || area === "pi") {
      await loadDetailPage({ area, id: name, offset: 0 });
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

  const saveSecret = () => {
    if (!secretKey.trim() || !secretValue) return;
    void mutate(`/api/secrets/${encodeURIComponent(secretKey.trim())}`, "PUT", {
      value: secretValue,
    });
    setSecretKey("");
    setSecretValue("");
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
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
        {detailLoading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#b7f34a" />
            <Text style={styles.loadingText}>Loading selected rows…</Text>
          </View>
        )}

        <View style={styles.pageControls}>
          <Pressable
            disabled={detailTarget.offset === 0 || detailLoading}
            onPress={() =>
              void loadDetailPage({
                ...detailTarget,
                offset: Math.max(0, detailTarget.offset - 50),
              })
            }
            style={styles.smallButton}
          >
            <Text style={styles.smallButtonText}>Newer 50</Text>
          </Pressable>
          <Text style={styles.pageText}>
            Rows {detailTarget.offset + 1}–{detailTarget.offset + 50}
          </Text>
          <Pressable
            disabled={detailLoading}
            onPress={() =>
              void loadDetailPage({ ...detailTarget, offset: detailTarget.offset + 50 })
            }
            style={styles.smallButton}
          >
            <Text style={styles.smallButtonText}>Older 50</Text>
          </Pressable>
        </View>

        {selected !== undefined && <StructuredRows data={selected} kind={detailTarget.area} />}
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

  return (
    <View style={[styles.root, area === "memory" && styles.memoryRoot]}>
      {(area !== "memory" || onBack) && (
        <View style={[styles.titleRow, onBack && styles.compactTitleRow]}>
          {onBack && (
            <Pressable onPress={onBack} style={styles.backButton}>
              <Text style={styles.backText}>‹</Text>
            </Pressable>
          )}
          {area !== "memory" && (
            <Text style={[styles.title, styles.screenTitle]}>
              {showAreaTabs
                ? "Run the family business."
                : operationAreas.find((item) => item.id === area)?.label}
            </Text>
          )}
          {onBack && <Text style={styles.compactRouteLabel}>Search results</Text>}
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

      {area !== "memory" && (
        <View style={styles.toolbar}>
          <View />
          <Pressable onPress={() => void load()} style={styles.smallButton}>
            <Text style={styles.smallButtonText}>Refresh</Text>
          </Pressable>
        </View>
      )}

      {area === "memory" && !initialMemoryQuery && (
        <View style={styles.memorySearchRow}>
          <Text style={styles.memorySearchIcon}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void searchMemory()}
            placeholder="Search memory"
            placeholderTextColor="#7e877e"
            returnKeyType="search"
            style={styles.memorySearchInput}
          />
          <Pressable
            accessibilityLabel="Open profile"
            onPress={async () => setSelected(await api("/api/memory/profile"))}
            style={styles.memoryTextAction}
          >
            <Text style={styles.memoryTextActionLabel}>Profile</Text>
          </Pressable>
        </View>
      )}

      {area === "providers" && activeProvider && (
        <View style={styles.editorBlock}>
          <TextInput
            value={providerPrompt}
            onChangeText={setProviderPrompt}
            placeholder="OAuth prompt or authorization code"
            placeholderTextColor="#687067"
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
            placeholderTextColor="#687067"
            style={[styles.input, styles.commandEditor]}
          />
          <Pressable onPress={runCommand} style={styles.primaryButton}>
            <Text style={styles.primaryText}>
              {editingJob ? `Update ${editingJob}` : "Create job"}
            </Text>
          </Pressable>
        </View>
      )}

      {area === "secrets" && (
        <View style={styles.editorBlock}>
          <TextInput
            value={secretKey}
            onChangeText={setSecretKey}
            autoCapitalize="none"
            placeholder="Secret key"
            placeholderTextColor="#687067"
            style={styles.input}
          />
          <TextInput
            value={secretValue}
            onChangeText={setSecretValue}
            secureTextEntry
            autoCapitalize="none"
            placeholder="Secret value"
            placeholderTextColor="#687067"
            style={styles.input}
          />
          <Pressable onPress={saveSecret} style={styles.primaryButton}>
            <Text style={styles.primaryText}>Save secret</Text>
          </Pressable>
        </View>
      )}

      {area === "drive" && (
        <View style={styles.formRow}>
          <TextInput
            value={drivePath}
            onChangeText={setDrivePath}
            placeholder="Drive path"
            placeholderTextColor="#687067"
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
          placeholderTextColor="#687067"
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
          <ActivityIndicator color="#b7f34a" />
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
            const title = memoryResult ? String(record.alias ?? record.session_id ?? name) : name;
            const context = memoryResult ? displayValue(record.context) : "";
            const memoryKey = String(record.id ?? `${record.session_id ?? "memory"}-${index}`);
            const memoryExpanded = memoryResult && expandedMemory.has(memoryKey);
            return (
              <View
                key={`${name}-${index}`}
                style={[styles.card, memoryResult && styles.memoryResultRow]}
              >
                {memoryResult ? (
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
                          setSelected(result);
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
                {area === "secrets" && record.isSystem !== true && record.system !== true && (
                  <Pressable
                    onPress={() =>
                      confirm(
                        `Delete ${name}`,
                        () =>
                          void mutate(`/api/secrets/${encodeURIComponent(identifier)}`, "DELETE"),
                      )
                    }
                  >
                    <Text style={styles.deleteLink}>delete</Text>
                  </Pressable>
                )}
                {(area === "traces" || area === "pi") && (
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
                          ? setDrivePath(record.path as string)
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
      {!loading && !rows && area !== "memory" && area !== "settings" && area !== "system" && (
        <StructuredDetail value={data} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingBottom: 70 },
  memoryRoot: { width: "100%", maxWidth: 820, alignSelf: "center" },
  memorySearchRow: {
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#596159",
    marginBottom: 38,
  },
  memorySearchIcon: { color: "#a3be8c", fontSize: 22 },
  memorySearchInput: { flex: 1, color: "#f0f2ed", fontSize: 15, paddingVertical: 12 },
  memoryTextAction: { paddingVertical: 10, paddingLeft: 12 },
  memoryTextActionLabel: { color: "#a3be8c", fontSize: 12, fontWeight: "700" },
  memorySummary: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#292e29",
  },
  memorySummaryPrimary: { color: "#f0f2ed", fontSize: 12, fontWeight: "700" },
  memorySummarySecondary: { color: "#7e877e", fontSize: 11 },
  flatSectionHeader: {
    paddingTop: 28,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#292e29",
  },
  flatSectionTitle: { color: "#f0f2ed", fontSize: 13, fontWeight: "700" },
  flatRow: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#1d211d",
  },
  flatRowMain: { flex: 1 },
  flatChevron: { color: "#7e877e", fontSize: 18 },
  eyebrow: { color: "#a3be8c", fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 18 },
  statCard: {
    width: "48%",
    minHeight: 90,
    borderRadius: 15,
    padding: 15,
    backgroundColor: "#151914",
    borderWidth: 1,
    borderColor: "#2b3228",
    justifyContent: "center",
  },
  statValue: { color: "#eef2e9", fontSize: 21, fontWeight: "800" },
  statLabel: {
    color: "#788075",
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 5,
  },
  fieldList: { gap: 1 },
  fieldRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#252a25" },
  fieldLabel: {
    color: "#798178",
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 5,
  },
  fieldValue: { color: "#e1e5df", fontSize: 14, lineHeight: 20 },
  detailList: { gap: 10 },
  detailGroup: {
    backgroundColor: "#121512",
    borderWidth: 1,
    borderColor: "#292e29",
    borderRadius: 14,
    padding: 14,
    marginTop: 8,
  },
  detailGroupTitle: {
    color: "#b9e877",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  detailValue: { color: "#e1e5df", fontSize: 14 },
  configFields: { gap: 10 },
  configGroup: { borderLeftWidth: 2, borderLeftColor: "#36432f", paddingLeft: 12, marginTop: 8 },
  configGroupTitle: { color: "#c6ee88", fontSize: 14, fontWeight: "800", marginBottom: 10 },
  configField: { gap: 5 },
  configMultiline: { minHeight: 90, textAlignVertical: "top" },
  booleanControl: {
    alignSelf: "flex-start",
    minWidth: 62,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "#343a34",
  },
  booleanControlOn: { backgroundColor: "#456528" },
  booleanText: { color: "#e7eee2", fontSize: 12, fontWeight: "800", textAlign: "center" },
  detailProse: {
    color: "#d9ddd7",
    fontSize: 14,
    lineHeight: 22,
    backgroundColor: "#121512",
    borderWidth: 1,
    borderColor: "#292e29",
    borderRadius: 14,
    padding: 15,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 },
  compactTitleRow: { marginBottom: 22 },
  compactRouteLabel: { color: "#a2a9a1", fontSize: 13, fontWeight: "700" },
  detailHeading: { flex: 1 },
  detailId: { color: "#858d82", fontSize: 11, fontFamily: "monospace", marginTop: 3 },
  title: { color: "#f3f5ef", fontSize: 30, fontWeight: "800", marginTop: 8 },
  screenTitle: { flex: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 6 },
  headerTextButton: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: "#20271d",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTextButtonLabel: { color: "#c8d1c3", fontSize: 11, fontWeight: "800" },
  headerIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#20271d",
    alignItems: "center",
    justifyContent: "center",
  },
  headerIcon: { color: "#b7f34a", fontSize: 20, fontWeight: "800" },
  resultCount: {
    color: "#6f786c",
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 14,
    marginBottom: 4,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#252b23",
    alignItems: "center",
    justifyContent: "center",
  },
  backText: { color: "#b7f34a", fontSize: 30, lineHeight: 31 },
  tabs: { marginHorizontal: -4, marginBottom: 20 },
  tabRow: { flexDirection: "row", gap: 8, paddingHorizontal: 4 },
  tab: {
    borderWidth: 1,
    borderColor: "#30362d",
    borderRadius: 99,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  tabActive: { backgroundColor: "#b7f34a", borderColor: "#b7f34a" },
  tabText: { color: "#aab0a7", fontSize: 13, fontWeight: "700" },
  tabTextActive: { color: "#11150d" },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  section: { color: "#f3f5ef", fontSize: 18, fontWeight: "800" },
  formRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  input: {
    flex: 1,
    color: "#f3f5ef",
    backgroundColor: "#151914",
    borderWidth: 1,
    borderColor: "#30362d",
    borderRadius: 12,
    padding: 12,
  },
  editorBlock: { gap: 10 },
  editor: { minHeight: 360, fontFamily: "monospace", fontSize: 12, textAlignVertical: "top" },
  driveFolder: { marginBottom: 14 },
  commandEditor: {
    minHeight: 110,
    fontFamily: "monospace",
    fontSize: 12,
    textAlignVertical: "top",
  },
  smallButton: {
    backgroundColor: "#252b23",
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 10,
    alignSelf: "flex-start",
  },
  smallButtonText: { color: "#dce2d7", fontWeight: "700", fontSize: 12 },
  primaryButton: {
    backgroundColor: "#b7f34a",
    borderRadius: 11,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignSelf: "flex-start",
  },
  primaryText: { color: "#11150d", fontWeight: "800" },
  dangerButton: { borderWidth: 1, borderColor: "#7f3838", borderRadius: 11, padding: 12 },
  dangerText: { color: "#ff9e9e", fontWeight: "800" },
  actionRow: { marginBottom: 14 },
  loader: { margin: 24 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 18 },
  loadingText: { color: "#aab0a7", fontWeight: "700" },
  pageControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 14,
  },
  pageText: { color: "#858d82", fontSize: 11 },
  error: { color: "#ff9e9e", marginVertical: 10 },
  list: { gap: 9 },
  card: {
    backgroundColor: "#151914",
    borderWidth: 1,
    borderColor: "#292f27",
    borderRadius: 14,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  memoryResultRow: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: "#1d211d",
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 15,
  },
  cardMain: { flex: 1 },
  cardTitle: { color: "#f0f3ed", fontWeight: "800", fontSize: 14 },
  cardMeta: { color: "#858d82", fontSize: 12, marginTop: 4 },
  memoryContext: {
    color: "#b8c2b3",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 7,
    paddingLeft: 9,
    borderLeftWidth: 2,
    borderLeftColor: "#536548",
  },
  memoryExpansion: { marginTop: 12, paddingTop: 11, borderTopWidth: 1, borderTopColor: "#30362e" },
  memoryExpansionLabel: {
    color: "#7f897b",
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 7,
  },
  memoryExpansionText: { color: "#d9ddd7", fontSize: 12, lineHeight: 19, fontFamily: "monospace" },
  memoryHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  memoryIdentity: { flex: 1, minWidth: 0 },
  memoryDay: { color: "#eef1eb", fontSize: 13, fontWeight: "800" },
  memorySession: { color: "#747d72", fontSize: 10, fontFamily: "monospace", marginTop: 3 },
  memoryExpandButton: {
    width: 36,
    height: 36,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  memoryExpandIcon: { color: "#a3be8c", fontSize: 19, fontWeight: "700", lineHeight: 21 },
  inlineActions: { flexDirection: "row", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" },
  link: { color: "#b7f34a", fontSize: 12, fontWeight: "800" },
  deleteLink: { color: "#ff8d8d", fontSize: 12, fontWeight: "800" },
  structuredList: { gap: 9 },
  eventCard: { borderWidth: 1, borderRadius: 13, padding: 12 },
  eventNeutral: { backgroundColor: "#151914", borderColor: "#30362d" },
  eventUser: { backgroundColor: "#101b24", borderColor: "#244760" },
  eventAssistant: { backgroundColor: "#191329", borderColor: "#43306b" },
  eventTool: { backgroundColor: "#102019", borderColor: "#28523b" },
  eventError: { backgroundColor: "#251313", borderColor: "#713b3b" },
  eventHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  eventBadge: {
    color: "#b7f34a",
    backgroundColor: "#252b23",
    borderRadius: 7,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
    fontSize: 10,
    fontWeight: "800",
    fontFamily: "monospace",
  },
  eventTitle: {
    color: "#e6eae3",
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  eventChevron: { color: "#7d857b", fontSize: 18 },
  eventPreview: { color: "#929a8f", fontSize: 12, lineHeight: 17, marginTop: 8 },
  eventBody: {
    color: "#c4cbc1",
    fontSize: 11,
    lineHeight: 17,
    marginTop: 10,
    fontFamily: "monospace",
  },
  emptyText: { color: "#858d82", textAlign: "center", padding: 24 },
  jsonCard: {
    backgroundColor: "#10130f",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#292f27",
  },
  json: { color: "#b8c0b5", fontFamily: "monospace", fontSize: 11, lineHeight: 17 },
  detail: {
    marginTop: 18,
    backgroundColor: "#10130f",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#3a4236",
  },
});
