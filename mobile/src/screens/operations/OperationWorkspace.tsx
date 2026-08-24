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
