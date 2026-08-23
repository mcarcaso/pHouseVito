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
}: {
  onUnauthorized: () => void;
  initialArea?: OperationArea;
  showAreaTabs?: boolean;
  onBack?: () => void;
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
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState("");
  const [drivePath, setDrivePath] = useState("");
  const [command, setCommand] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [siteFolder, setSiteFolder] = useState("");
  const [providerPrompt, setProviderPrompt] = useState("");
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [editingJob, setEditingJob] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected(undefined);
    try {
      const path =
        area === "drive" ? `/api/drive/ls?path=${encodeURIComponent(drivePath)}` : paths[area];
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
  }, [area, drivePath, onUnauthorized]);

  useEffect(() => void load(), [load]);

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
      setDetailTarget(target);
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

  return (
    <View style={styles.root}>
      <Text style={styles.eyebrow}>COMPANION OPERATIONS</Text>
      <View style={styles.titleRow}>
        {onBack && (
          <Pressable onPress={onBack} style={styles.backButton}>
            <Text style={styles.backText}>‹</Text>
          </Pressable>
        )}
        <Text style={styles.title}>
          {showAreaTabs
            ? "Run the family business."
            : operationAreas.find((item) => item.id === area)?.label}
        </Text>
      </View>
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

      <View style={styles.toolbar}>
        <Text style={styles.section}>{operationAreas.find((item) => item.id === area)?.label}</Text>
        <Pressable onPress={() => void load()} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>Refresh</Text>
        </Pressable>
      </View>

      {area === "memory" && (
        <View style={styles.formRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void searchMemory()}
            placeholder="Search memory"
            placeholderTextColor="#687067"
            style={styles.input}
          />
          <Pressable onPress={() => void searchMemory()} style={styles.smallButton}>
            <Text style={styles.smallButtonText}>Search</Text>
          </Pressable>
          <Pressable
            onPress={async () => setSelected(await api("/api/memory/profile"))}
            style={styles.smallButton}
          >
            <Text style={styles.smallButtonText}>Profile</Text>
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
          <TextInput
            multiline
            value={editor}
            onChangeText={setEditor}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, styles.editor]}
          />
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

      {!loading && rows && (
        <View style={styles.list}>
          {rows.map((row, index) => {
            const record = (row ?? {}) as Record<string, unknown>;
            const name = labelFor(row, index);
            const identifier = rowIdentifier(row, index);
            return (
              <View key={`${name}-${index}`} style={styles.card}>
                <Pressable onPress={() => void openRow(row, index)} style={styles.cardMain}>
                  <Text style={styles.cardTitle}>{name}</Text>
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

      {!loading && !rows && area !== "settings" && area !== "system" && (
        <View style={styles.jsonCard}>
          <Text selectable style={styles.json}>
            {pretty(data)}
          </Text>
        </View>
      )}

      {selected !== undefined && (
        <View style={styles.detail}>
          {detailTarget && (
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
          )}
          <View style={styles.toolbar}>
            <Text style={styles.section}>Details</Text>
            <Pressable
              onPress={() => {
                setSelected(undefined);
                setDetailTarget(null);
              }}
            >
              <Text style={styles.link}>close</Text>
            </Pressable>
          </View>
          <Text selectable style={styles.json}>
            {pretty(selected)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingBottom: 70 },
  eyebrow: { color: "#b7f34a", fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 },
  title: { color: "#f3f5ef", fontSize: 30, fontWeight: "800", marginTop: 8 },
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
  cardMain: { flex: 1 },
  cardTitle: { color: "#f0f3ed", fontWeight: "800", fontSize: 14 },
  cardMeta: { color: "#858d82", fontSize: 12, marginTop: 4 },
  inlineActions: { flexDirection: "row", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" },
  link: { color: "#b7f34a", fontSize: 12, fontWeight: "800" },
  deleteLink: { color: "#ff8d8d", fontSize: 12, fontWeight: "800" },
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
