import { StyleSheet } from "react-native";
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
import { useAgentName } from "../../contexts/agentIdentity";
import { api, VITO_URL } from "../../services/api/client";
import { MarkdownText } from "../../components/markdown/MarkdownText";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";

import { operationAreas, type OperationArea } from "./operation-catalog";

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

import {
  MemoryOverview,
  PiSessionDeleteContainer,
  StructuredConfigEditor,
  StructuredDetail,
  StructuredRows,
  displayValue,
  formatBytes,
  formatMemoryDay,
  labelFor,
  pretty,
} from "./structured-data";

function tracePreviewInfo(preview: unknown) {
  const result = { session: "", channel: "", model: "" };
  if (typeof preview !== "string") return result;
  for (const line of preview.split("\n")) {
    if (line.startsWith("Session:")) result.session = line.slice(8).trim();
    if (line.startsWith("Channel:")) result.channel = line.slice(8).trim();
    if (line.startsWith("Model:")) result.model = line.slice(6).trim();
  }
  return result;
}

function traceUserMessage(record: Record<string, unknown>): string {
  const message = String(record.userMessage ?? "");
  if (record.traceType !== "classifier" || !message.includes("<user-message>")) return message;
  return message.match(/<user-message>\s*([\s\S]*?)\s*<\/user-message>/)?.[1]?.trim() ?? message;
}

function formatServerUptime(value: number): string {
  const days = Math.floor(value / 86_400);
  const hours = Math.floor((value % 86_400) / 3_600);
  const minutes = Math.floor((value % 3_600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatMegabytes(value: number): string {
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

function formatGigabytes(value: number): string {
  return `${(value / 1_073_741_824).toFixed(1)} GB`;
}

function ServerOverview({
  value,
  agentName,
  onRestart,
}: {
  value: unknown;
  agentName: string;
  onRestart: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const status = (value ?? {}) as {
    uptime?: number;
    pid?: number;
    nodeVersion?: string;
    memoryUsage?: {
      rss?: number;
      heapTotal?: number;
      heapUsed?: number;
      external?: number;
    };
    system?: {
      cpuUsage?: number;
      memoryTotal?: number;
      memoryUsed?: number;
      memoryFree?: number;
    };
  };
  const uptime = Number(status.uptime ?? 0);
  const rss = Number(status.memoryUsage?.rss ?? 0);
  const heapUsed = Number(status.memoryUsage?.heapUsed ?? 0);
  const heapTotal = Number(status.memoryUsage?.heapTotal ?? 0);
  const heapPercent = heapTotal ? Math.min(100, (heapUsed / heapTotal) * 100) : 0;
  const cpuUsage = Number(status.system?.cpuUsage ?? 0);
  const memoryTotal = Number(status.system?.memoryTotal ?? 0);
  const memoryUsed = Number(status.system?.memoryUsed ?? 0);

  return (
    <View style={styles.serverRoot}>
      <View style={styles.serverHero}>
        <View style={styles.serverStatusIcon}>
          <Ionicons name="server-outline" size={25} color={theme.colors.success} />
          <View style={styles.serverOnlineDot} />
        </View>
        <View style={styles.serverHeroCopy}>
          <View style={styles.serverStatusLine}>
            <Text style={styles.serverHeroTitle}>Online</Text>
            <View style={styles.serverHealthyBadge}>
              <Text style={styles.serverHealthyText}>HEALTHY</Text>
            </View>
          </View>
          <Text style={styles.serverHeroSubtitle}>{agentName} is running normally.</Text>
        </View>
      </View>

      <View style={styles.serverMetrics}>
        <View style={styles.serverMetricCard}>
          <Ionicons name="time-outline" size={18} color={theme.colors.accent} />
          <Text style={styles.serverMetricValue}>{formatServerUptime(uptime)}</Text>
          <Text style={styles.serverMetricLabel}>Uptime</Text>
        </View>
        <View style={styles.serverMetricCard}>
          <Ionicons name="pulse-outline" size={18} color={theme.colors.info} />
          <Text style={styles.serverMetricValue}>{cpuUsage.toFixed(1)}%</Text>
          <Text style={styles.serverMetricLabel}>System CPU</Text>
        </View>
        <View style={styles.serverMetricCard}>
          <Ionicons name="hardware-chip-outline" size={18} color={theme.colors.success} />
          <Text style={styles.serverMetricValue}>{formatGigabytes(memoryUsed)}</Text>
          <Text style={styles.serverMetricLabel}>of {formatGigabytes(memoryTotal)} RAM</Text>
        </View>
      </View>

      <View style={styles.serverPanel}>
        <Text style={styles.serverSectionTitle}>Runtime</Text>
        <View style={styles.serverRuntimeRow}>
          <Text style={styles.serverRuntimeLabel}>Node.js</Text>
          <Text style={styles.serverRuntimeValue}>{status.nodeVersion ?? "—"}</Text>
        </View>
        <View style={styles.serverRuntimeRule} />
        <View style={styles.serverRuntimeRow}>
          <Text style={styles.serverRuntimeLabel}>Process ID</Text>
          <Text style={styles.serverRuntimeValue}>{status.pid ?? "—"}</Text>
        </View>
        <View style={styles.serverRuntimeRule} />
        <View style={styles.serverRuntimeRow}>
          <Text style={styles.serverRuntimeLabel}>Process memory</Text>
          <Text style={styles.serverRuntimeValue}>{formatMegabytes(rss)} RSS</Text>
        </View>
        <View style={styles.serverRuntimeRule} />
        <View style={styles.serverRuntimeRow}>
          <Text style={styles.serverRuntimeLabel}>Heap usage</Text>
          <Text style={styles.serverRuntimeValue}>
            {formatMegabytes(heapUsed)} / {formatMegabytes(heapTotal)}
          </Text>
        </View>
        <View style={styles.serverHeapTrack}>
          <View style={[styles.serverHeapFill, { width: `${heapPercent}%` }]} />
        </View>
      </View>

      <View style={[styles.serverPanel, styles.serverControlPanel]}>
        <View style={styles.serverControlHeading}>
          <View style={styles.serverControlIcon}>
            <Ionicons name="refresh" size={18} color={theme.colors.warning} />
          </View>
          <View style={styles.serverHeroCopy}>
            <Text style={styles.serverSectionTitle}>Server controls</Text>
            <Text style={styles.serverControlDescription}>
              Rebuilds the backend and dashboard, then restarts the PM2 process.
            </Text>
          </View>
        </View>
        <Pressable onPress={onRestart} style={styles.serverRestartButton}>
          <Ionicons name="refresh" size={17} color={theme.colors.danger} />
          <Text style={styles.serverRestartText}>Rebuild & restart</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function OperationWorkspace({
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
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const agentName = useAgentName();
  const [area, setArea] = useState<OperationArea>(initialArea);
  const [data, setData] = useState<unknown>();
  const [selected, setSelected] = useState<unknown>();
  const [detailTarget, setDetailTarget] = useState<{
    area: "traces" | "pi";
    id: string;
    offset: number;
  } | null>(initialDetail ? { ...initialDetail, offset: 0 } : null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [hasOlderDetailRows, setHasOlderDetailRows] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialMemoryQuery ?? "");
  const [memoryMode, setMemoryMode] = useState<"hybrid" | "embedding" | "bm25">(initialMemoryMode);
  const [memoryLimit, setMemoryLimit] = useState(String(initialMemoryLimit));
  const [showMemoryAdvanced, setShowMemoryAdvanced] = useState(false);
  const [showPiRaw, setShowPiRaw] = useState(initialShowRaw);
  const [hideTraceRaw, setHideTraceRaw] = useState(false);
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
    Alert.alert(title, `This action changes ${agentName}. Continue?`, [
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
            {detailTarget.area === "traces" && (
              <Pressable
                onPress={() => setHideTraceRaw((value) => !value)}
                style={[styles.rawToggle, hideTraceRaw && styles.rawToggleActive]}
              >
                <Text style={[styles.rawToggleText, hideTraceRaw && styles.rawToggleTextActive]}>
                  {hideTraceRaw ? "SHOW RAW" : "HIDE RAW"}
                </Text>
              </Pressable>
            )}
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
          <StructuredRows
            data={selected}
            kind={detailTarget.area}
            showRaw={showPiRaw}
            hideRawEvents={hideTraceRaw}
          />
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
        <ServerOverview
          value={data}
          agentName={agentName}
          onRestart={() =>
            confirm(
              `Rebuild and restart ${agentName}`,
              () => void mutate("/api/server/restart", "POST"),
            )
          }
        />
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
            const traceResult = area === "traces" && typeof record.filename === "string";
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
                {traceResult ? (
                  <Pressable onPress={() => void openRow(row, index)} style={styles.traceMain}>
                    <View style={styles.traceTop}>
                      <View style={styles.traceIdentity}>
                        <Text style={styles.traceTitle} numberOfLines={1}>
                          {String(
                            record.alias ||
                              record.sessionId ||
                              tracePreviewInfo(record.preview).session ||
                              record.filename,
                          )}
                        </Text>
                        {!!record.alias && (
                          <Text style={styles.traceSession} numberOfLines={1}>
                            {String(record.sessionId || tracePreviewInfo(record.preview).session)}
                          </Text>
                        )}
                      </View>
                      <Text style={styles.traceDate}>
                        {new Date(Number(record.timestamp)).toLocaleString()}
                      </Text>
                      <Ionicons name="chevron-forward" size={17} color={theme.colors.textMuted} />
                    </View>
                    <View style={styles.traceMeta}>
                      {String(record.traceType || "main") !== "main" && (
                        <Text
                          style={[
                            styles.traceTag,
                            record.traceType === "classifier"
                              ? styles.traceClassifier
                              : styles.traceProfile,
                          ]}
                        >
                          {String(record.traceType).toUpperCase()}
                        </Text>
                      )}
                      {!!tracePreviewInfo(record.preview).channel && (
                        <Text style={styles.traceTag}>
                          {tracePreviewInfo(record.preview).channel}
                        </Text>
                      )}
                      {!!tracePreviewInfo(record.preview).model && (
                        <Text style={[styles.traceTag, styles.traceModel]} numberOfLines={1}>
                          {tracePreviewInfo(record.preview).model}
                        </Text>
                      )}
                      {typeof record.cost === "number" && (
                        <Text style={styles.traceCost}>${Number(record.cost).toFixed(4)}</Text>
                      )}
                      <Text style={styles.traceSize}>{formatBytes(record.size)}</Text>
                      {record.hasEmbedding === true && (
                        <Ionicons name="sparkles-outline" size={13} color={theme.colors.success} />
                      )}
                    </View>
                    {!!traceUserMessage(record) && (
                      <Text style={styles.traceMessage} numberOfLines={2}>
                        {traceUserMessage(record)}
                      </Text>
                    )}
                  </Pressable>
                ) : piSession ? (
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
                {area === "drive" && typeof record.path === "string" && (
                  <View style={styles.inlineActions}>
                    <Pressable
                      onPress={() =>
                        record.isDirectory === true || record.isDir === true
                          ? onOpenDriveDirectory
                            ? onOpenDriveDirectory(record.path as string)
                            : setDrivePath(record.path as string)
                          : void Linking.openURL(
                              `${VITO_URL}/d/${String(record.path).split("/").map(encodeURIComponent).join("/")}`,
                            )
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
        area !== "system" &&
        area !== "server" && <StructuredDetail value={data} />}
    </View>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    root: {},
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      marginBottom: theme.space.xl,
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: theme.colors.surfaceRaised,
      alignItems: "center",
      justifyContent: "center",
    },
    backText: { color: theme.colors.accent, fontSize: 30, lineHeight: 31 },
    detailHeading: { flex: 1, minWidth: 0 },
    title: { color: theme.colors.text, fontSize: 30, fontWeight: "800", marginTop: theme.space.sm },
    detailId: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontFamily: "monospace",
      marginTop: theme.space.xs,
    },
    rawToggle: {
      height: 32,
      justifyContent: "center",
      paddingHorizontal: theme.space.sm,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
    },
    rawToggleActive: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accentSurface,
    },
    rawToggleText: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: "900",
      letterSpacing: 0.8,
    },
    rawToggleTextActive: { color: theme.colors.accent },
    error: { color: theme.colors.danger, marginVertical: theme.space.md },
    loadingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      paddingVertical: theme.space.xl,
    },
    loadingText: { color: theme.colors.textSecondary, fontWeight: "700" },
    loadMoreSeparator: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      marginBottom: theme.space.lg,
    },
    loadMoreRule: { flex: 1, height: 1, backgroundColor: theme.colors.separator },
    loadMoreButton: {
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.sm,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      backgroundColor: theme.colors.surface,
    },
    loadMoreText: { color: theme.colors.textSecondary, fontSize: 11, fontWeight: "700" },
    memoryRoot: { width: "100%", maxWidth: 820, alignSelf: "center" },
    memoryLanding: { flex: 1, justifyContent: "center", paddingBottom: theme.space.massive },
    memoryLandingTitle: {
      color: theme.colors.text,
      fontSize: 28,
      fontWeight: "800",
      textAlign: "center",
      letterSpacing: -0.8,
    },
    memoryLandingSubtitle: {
      color: theme.colors.textMuted,
      fontSize: 13,
      textAlign: "center",
      marginTop: theme.space.sm,
      marginBottom: theme.space.xxl,
    },
    memoryLandingSearch: {
      minHeight: 54,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      borderRadius: 16,
      backgroundColor: theme.colors.surface,
      paddingLeft: theme.space.lg,
      paddingRight: theme.space.xs,
    },
    memorySearchIcon: { color: theme.colors.accent, fontSize: 22 },
    memorySearchInput: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 15,
      paddingVertical: theme.space.md,
    },
    memorySearchButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: 12,
      paddingHorizontal: theme.space.lg,
      paddingVertical: theme.space.md,
    },
    memorySearchButtonText: { color: theme.colors.accentText, fontSize: 12, fontWeight: "800" },
    memoryAdvancedToggle: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: "700",
      marginTop: theme.space.md,
      textAlign: "center",
    },
    memoryAdvancedPanel: {
      marginTop: theme.space.md,
      borderTopWidth: 1,
      borderTopColor: theme.colors.separator,
      paddingTop: theme.space.md,
      gap: theme.space.md,
    },
    memoryModeRow: { flexDirection: "row", justifyContent: "center", gap: theme.space.sm },
    memoryModeButton: {
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      borderRadius: 99,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.sm,
    },
    memoryModeButtonActive: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    memoryModeText: { color: theme.colors.textSecondary, fontSize: 11, fontWeight: "700" },
    memoryModeTextActive: { color: theme.colors.accentText },
    memoryLimitRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.space.sm,
    },
    memoryLimitLabel: { color: theme.colors.textMuted, fontSize: 11 },
    memoryLimitInput: {
      width: 56,
      color: theme.colors.text,
      textAlign: "center",
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separatorStrong,
      paddingVertical: theme.space.xs,
    },
    compactTitleRow: { marginBottom: theme.space.xxl },
    screenTitle: { flex: 1 },
    tabs: { marginHorizontal: -4, marginBottom: theme.space.xl },
    tabRow: { flexDirection: "row", gap: theme.space.sm, paddingHorizontal: theme.space.xs },
    tab: {
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      borderRadius: 99,
      paddingHorizontal: theme.space.lg,
      paddingVertical: theme.space.sm,
    },
    tabActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
    tabText: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: "700" },
    tabTextActive: { color: theme.colors.accentText },
    toolbar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.space.md,
      marginBottom: theme.space.md,
    },
    iconButton: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      backgroundColor: theme.colors.surfaceRaised,
    },
    smallButton: {
      backgroundColor: theme.colors.surfaceRaised,
      borderRadius: 10,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.md,
      alignSelf: "flex-start",
    },
    smallButtonText: { color: theme.colors.textSecondary, fontWeight: "700", fontSize: 12 },
    memorySearchRow: {
      height: 50,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separatorStrong,
      marginBottom: theme.space.huge,
    },
    editorBlock: { gap: theme.space.md },
    input: {
      flex: 1,
      color: theme.colors.text,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      borderRadius: 12,
      padding: theme.space.md,
    },
    formRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.space.sm,
      marginBottom: theme.space.lg,
    },
    commandEditor: {
      minHeight: 110,
      fontFamily: "monospace",
      fontSize: 12,
      textAlignVertical: "top",
    },
    primaryButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: 11,
      paddingHorizontal: theme.space.lg,
      paddingVertical: theme.space.md,
      alignSelf: "flex-start",
    },
    primaryText: { color: theme.colors.accentText, fontWeight: "800" },
    driveFolder: { marginBottom: theme.space.lg },
    editor: { minHeight: 360, fontFamily: "monospace", fontSize: 12, textAlignVertical: "top" },
    actionRow: { marginBottom: theme.space.lg },
    serverRoot: {
      width: "100%",
      maxWidth: 760,
      alignSelf: "center",
      gap: theme.space.md,
      paddingBottom: theme.space.xxl,
    },
    serverHero: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.lg,
      padding: theme.space.xl,
      backgroundColor: theme.colors.successSurface,
      borderWidth: 1,
      borderColor: theme.colors.success,
      borderRadius: theme.radius.lg,
    },
    serverStatusIcon: {
      width: 52,
      height: 52,
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surface,
      position: "relative",
    },
    serverOnlineDot: {
      position: "absolute",
      right: 5,
      bottom: 5,
      width: 9,
      height: 9,
      borderRadius: theme.radius.round,
      backgroundColor: theme.colors.success,
      borderWidth: 2,
      borderColor: theme.colors.surface,
    },
    serverHeroCopy: { flex: 1, minWidth: 0 },
    serverStatusLine: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
    serverHeroTitle: { color: theme.colors.text, fontSize: 20, fontWeight: "800" },
    serverHealthyBadge: {
      borderRadius: theme.radius.round,
      paddingHorizontal: theme.space.sm,
      paddingVertical: theme.space.xs,
      backgroundColor: theme.colors.success,
    },
    serverHealthyText: {
      color: theme.colors.accentText,
      fontSize: 8,
      fontWeight: "900",
      letterSpacing: 0.8,
    },
    serverHeroSubtitle: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      marginTop: theme.space.xs,
    },
    serverMetrics: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
    serverMetricCard: {
      flexGrow: 1,
      flexBasis: 150,
      minWidth: 140,
      padding: theme.space.lg,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      borderRadius: theme.radius.lg,
    },
    serverMetricValue: {
      color: theme.colors.text,
      fontSize: 21,
      fontWeight: "800",
      letterSpacing: -0.5,
      marginTop: theme.space.md,
    },
    serverMetricLabel: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.8,
      marginTop: theme.space.xs,
    },
    serverPanel: {
      padding: theme.space.xl,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      borderRadius: theme.radius.lg,
    },
    serverSectionTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "800" },
    serverRuntimeRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: theme.space.lg,
      paddingVertical: theme.space.md,
    },
    serverRuntimeLabel: { color: theme.colors.textMuted, fontSize: 12 },
    serverRuntimeValue: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      fontWeight: "700",
      fontFamily: "monospace",
      textAlign: "right",
    },
    serverRuntimeRule: { height: 1, backgroundColor: theme.colors.separator },
    serverHeapTrack: {
      height: 5,
      overflow: "hidden",
      borderRadius: theme.radius.round,
      backgroundColor: theme.colors.surfaceRaised,
    },
    serverHeapFill: {
      height: "100%",
      borderRadius: theme.radius.round,
      backgroundColor: theme.colors.success,
    },
    serverControlPanel: { gap: theme.space.lg },
    serverControlHeading: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.md },
    serverControlIcon: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceRaised,
    },
    serverControlDescription: {
      color: theme.colors.textMuted,
      fontSize: 11,
      lineHeight: 16,
      marginTop: theme.space.xs,
    },
    serverRestartButton: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.space.sm,
      borderWidth: 1,
      borderColor: theme.colors.danger,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.dangerSurface,
    },
    serverRestartText: { color: theme.colors.danger, fontSize: 12, fontWeight: "800" },
    dangerButton: {
      borderWidth: 1,
      borderColor: theme.colors.danger,
      borderRadius: 11,
      padding: theme.space.md,
    },
    dangerText: { color: theme.colors.danger, fontWeight: "800" },
    resultCount: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 1,
      marginTop: theme.space.lg,
      marginBottom: theme.space.xs,
    },
    list: { gap: theme.space.sm },
    card: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      borderRadius: 14,
      padding: theme.space.md,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
    },
    memoryResultRow: {
      backgroundColor: "transparent",
      borderWidth: 0,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
      borderRadius: 0,
      paddingHorizontal: theme.space.xxs,
      paddingVertical: theme.space.lg,
    },
    traceMain: { flex: 1, minWidth: 0, gap: theme.space.sm },
    traceTop: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
    traceIdentity: { flex: 1, minWidth: 0 },
    traceTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "800" },
    traceSession: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontFamily: "monospace",
      marginTop: theme.space.xxs,
    },
    traceDate: { color: theme.colors.textMuted, fontSize: 10 },
    traceMeta: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: theme.space.xs,
    },
    traceTag: {
      color: theme.colors.textMuted,
      backgroundColor: theme.colors.surfaceRaised,
      fontSize: 9,
      fontWeight: "800",
      paddingHorizontal: theme.space.sm,
      paddingVertical: theme.space.xs,
      borderRadius: 5,
      overflow: "hidden",
    },
    traceClassifier: { color: theme.colors.warning },
    traceProfile: { color: theme.colors.info },
    traceModel: { color: theme.colors.accent, maxWidth: 220 },
    traceCost: { color: theme.colors.success, fontSize: 10, fontFamily: "monospace" },
    traceSize: { color: theme.colors.textMuted, fontSize: 10 },
    traceMessage: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 17 },
    piSessionMain: { flex: 1, minWidth: 0, gap: theme.space.sm },
    piSessionTop: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
    piSessionTitle: { flex: 1, color: theme.colors.text, fontSize: 14, fontWeight: "800" },
    piSessionDate: { color: theme.colors.textMuted, fontSize: 10 },
    piSessionMeta: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      flexWrap: "wrap",
    },
    piSessionTag: {
      color: theme.colors.textMuted,
      backgroundColor: theme.colors.surfaceRaised,
      paddingHorizontal: theme.space.sm,
      paddingVertical: theme.space.xxs,
      borderRadius: 5,
      fontSize: 10,
      overflow: "hidden",
    },
    piSessionModel: { color: theme.colors.accent, maxWidth: 220 },
    piSessionSize: { color: theme.colors.textMuted, fontSize: 10 },
    piSessionId: { color: theme.colors.textMuted, fontSize: 10, fontFamily: "monospace" },
    piSessionPreview: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 17 },
    cardMain: { flex: 1 },
    memoryHeader: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
    memoryIdentity: { flex: 1, minWidth: 0 },
    memoryDay: { color: theme.colors.text, fontSize: 13, fontWeight: "800" },
    memorySession: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontFamily: "monospace",
      marginTop: theme.space.xs,
    },
    memoryExpandButton: {
      width: 36,
      height: 36,
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    memoryExpandIcon: {
      color: theme.colors.accent,
      fontSize: 19,
      fontWeight: "700",
      lineHeight: 21,
    },
    memoryContext: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      marginTop: theme.space.sm,
      paddingLeft: theme.space.sm,
      borderLeftWidth: 2,
      borderLeftColor: theme.colors.separatorStrong,
    },
    memoryScores: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.space.md,
      marginTop: theme.space.sm,
    },
    memoryScore: { fontFamily: "monospace", fontSize: 10, fontWeight: "700" },
    memoryScoreRrf: { color: theme.colors.success },
    memoryScoreEmbedding: { color: theme.colors.info },
    memoryScoreDecay: { color: theme.colors.accent },
    memoryScoreBm25: { color: theme.colors.warning },
    memoryExpansion: {
      marginTop: theme.space.md,
      paddingTop: theme.space.md,
      borderTopWidth: 1,
      borderTopColor: theme.colors.separator,
    },
    memoryExpansionLabel: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "900",
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: theme.space.sm,
    },
    memoryExpansionText: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      lineHeight: 19,
      fontFamily: "monospace",
    },
    cardTitle: { color: theme.colors.text, fontWeight: "800", fontSize: 14 },
    cardMeta: { color: theme.colors.textMuted, fontSize: 12, marginTop: theme.space.xs },
    inlineActions: {
      flexDirection: "row",
      gap: theme.space.md,
      flexWrap: "wrap",
      justifyContent: "flex-end",
    },
    link: { color: theme.colors.accent, fontSize: 12, fontWeight: "800" },
    deleteLink: { color: theme.colors.danger, fontSize: 12, fontWeight: "800" },
  });
