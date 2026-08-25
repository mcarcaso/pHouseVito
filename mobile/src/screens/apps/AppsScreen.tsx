import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { api } from "../../services/api/client";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";

type AppStatus = "online" | "stopped" | "errored" | "unknown" | string;
export interface ManagedApp {
  name: string;
  description: string;
  port: number;
  url: string;
  createdAt: string;
  status: AppStatus;
  uptime: number | null;
  restarts: number;
  memory: number | null;
}
interface AppFile {
  path: string;
  size: number;
  isDir: boolean;
}

const formatBytes = (value: number | null) =>
  value == null
    ? "—"
    : value < 1024 * 1024
      ? `${Math.round(value / 1024)} KB`
      : `${(value / 1024 / 1024).toFixed(1)} MB`;
const formatUptime = (value: number | null) => {
  if (value == null) return "—";
  const minutes = Math.floor(value / 60000);
  return minutes >= 1440
    ? `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
    : minutes >= 60
      ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
      : `${minutes}m`;
};
const statusColor = (theme: VitoTheme, status: AppStatus) =>
  status === "online"
    ? theme.colors.success
    : status === "errored"
      ? theme.colors.danger
      : theme.colors.textMuted;

export function AppsScreen({
  refreshKey,
  onOpen,
  onUnauthorized,
}: {
  refreshKey?: number;
  onOpen: (name: string) => void;
  onUnauthorized: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [apps, setApps] = useState<ManagedApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    async (refresh = false) => {
      refresh ? setRefreshing(true) : setLoading(true);
      try {
        setApps(await api<ManagedApp[]>("/api/apps"));
        setError(null);
      } catch (cause) {
        if (cause instanceof Error && cause.message.includes("401")) onUnauthorized();
        else setError(cause instanceof Error ? cause.message : "Could not load apps");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onUnauthorized],
  );
  useEffect(() => {
    void load();
  }, [load, refreshKey]);
  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  return (
    <ScrollView
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load(true)}
          tintColor={theme.colors.accent}
        />
      }
      contentContainerStyle={styles.list}
    >
      <View style={styles.summary}>
        <Text style={styles.summaryValue}>{apps.length}</Text>
        <Text style={styles.summaryLabel}>DEPLOYED</Text>
        <View style={styles.summaryDivider} />
        <Text style={styles.summaryValue}>
          {apps.filter((app) => app.status === "online").length}
        </Text>
        <Text style={styles.summaryLabel}>ONLINE</Text>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {!apps.length && !error && (
        <View style={styles.empty}>
          <Ionicons name="apps-outline" size={34} color={theme.colors.textMuted} />
          <Text style={styles.emptyTitle}>No apps deployed</Text>
          <Text style={styles.secondary}>Apps created by Vito will show up here.</Text>
        </View>
      )}
      {apps.map((app) => (
        <Pressable
          key={app.name}
          onPress={() => onOpen(app.name)}
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        >
          <View style={styles.cardTop}>
            <View style={[styles.appIcon, { borderColor: statusColor(theme, app.status) }]}>
              <Ionicons name="cube-outline" size={21} color={statusColor(theme, app.status)} />
            </View>
            <View style={styles.cardCopy}>
              <Text style={styles.name}>{app.name}</Text>
              <Text numberOfLines={2} style={styles.description}>
                {app.description || "Deployed application"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
          </View>
          <View style={styles.meta}>
            <View style={[styles.dot, { backgroundColor: statusColor(theme, app.status) }]} />
            <Text style={styles.status}>{app.status}</Text>
            <Text style={styles.metaText}>Port {app.port}</Text>
            {app.uptime != null && (
              <Text style={styles.metaText}>Up {formatUptime(app.uptime)}</Text>
            )}
          </View>
          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              void Linking.openURL(app.url);
            }}
            style={styles.urlRow}
          >
            <Text numberOfLines={1} style={styles.url}>
              {app.url.replace(/^https?:\/\//, "")}
            </Text>
            <Ionicons name="open-outline" size={15} color={theme.colors.accent} />
          </Pressable>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function AppDetailScreen({ name, onDeleted }: { name: string; onDeleted: () => void }) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [app, setApp] = useState<ManagedApp | null>(null);
  const [files, setFiles] = useState<AppFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, appFiles] = await Promise.all([
        api<ManagedApp[]>("/api/apps"),
        api<AppFile[]>(`/api/apps/${encodeURIComponent(name)}/files`),
      ]);
      setApp(all.find((item) => item.name === name) ?? null);
      setFiles(appFiles.filter((file) => !file.isDir));
    } finally {
      setLoading(false);
    }
  }, [name]);
  useEffect(() => {
    void load();
  }, [load]);
  const action = async (value: "start" | "stop" | "restart" | "delete") => {
    setBusy(value);
    try {
      await api(`/api/apps/${encodeURIComponent(name)}${value === "delete" ? "" : `/${value}`}`, {
        method: value === "delete" ? "DELETE" : "POST",
      });
      if (value === "delete") onDeleted();
      else await load();
    } catch (cause) {
      Alert.alert(
        "App action failed",
        cause instanceof Error ? cause.message : "Please try again.",
      );
    } finally {
      setBusy(null);
    }
  };
  const openFile = async (path: string) => {
    if (selected === path) {
      setSelected(null);
      setContent(null);
      return;
    }
    setSelected(path);
    setContent(null);
    try {
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      const result = await api<{ content: string }>(
        `/api/apps/${encodeURIComponent(name)}/files/${encoded}`,
      );
      setContent(result.content);
    } catch (cause) {
      setContent(cause instanceof Error ? cause.message : "Could not load file");
    }
  };
  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  if (!app)
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>App not found</Text>
      </View>
    );
  return (
    <ScrollView contentContainerStyle={styles.detail}>
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={[styles.largeIcon, { borderColor: statusColor(theme, app.status) }]}>
            <Ionicons name="cube" size={28} color={statusColor(theme, app.status)} />
          </View>
          <View style={styles.cardCopy}>
            <Text style={styles.detailName}>{app.name}</Text>
            <View style={styles.meta}>
              <View style={[styles.dot, { backgroundColor: statusColor(theme, app.status) }]} />
              <Text style={styles.status}>{app.status}</Text>
            </View>
          </View>
        </View>
        <Text style={styles.description}>{app.description || "Deployed application"}</Text>
        <Pressable onPress={() => void Linking.openURL(app.url)} style={styles.openButton}>
          <Ionicons name="open-outline" size={17} color={theme.colors.accentText} />
          <Text style={styles.openButtonText}>Open app</Text>
        </Pressable>
      </View>
      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{formatUptime(app.uptime)}</Text>
          <Text style={styles.metricLabel}>UPTIME</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{formatBytes(app.memory)}</Text>
          <Text style={styles.metricLabel}>MEMORY</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{app.restarts}</Text>
          <Text style={styles.metricLabel}>RESTARTS</Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.metricValue}>{app.port}</Text>
          <Text style={styles.metricLabel}>PORT</Text>
        </View>
      </View>
      <Text style={styles.sectionTitle}>CONTROLS</Text>
      <View style={styles.actions}>
        {app.status === "online" ? (
          <>
            <Action
              icon="refresh"
              label="Restart"
              busy={busy === "restart"}
              onPress={() => void action("restart")}
            />
            <Action
              icon="stop"
              label="Stop"
              busy={busy === "stop"}
              onPress={() => void action("stop")}
            />
          </>
        ) : (
          <Action
            icon="play"
            label="Start"
            busy={busy === "start"}
            onPress={() => void action("start")}
          />
        )}
        <Action
          icon="trash-outline"
          label="Delete"
          danger
          busy={busy === "delete"}
          onPress={() =>
            Alert.alert("Delete app?", `${name} and its files will be permanently removed.`, [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => void action("delete") },
            ])
          }
        />
      </View>
      <Text style={styles.sectionTitle}>FILES · {files.length}</Text>
      <View style={styles.fileList}>
        {files.map((file) => (
          <View key={file.path}>
            <Pressable onPress={() => void openFile(file.path)} style={styles.fileRow}>
              <Ionicons name="document-text-outline" size={18} color={theme.colors.textSecondary} />
              <View style={styles.cardCopy}>
                <Text style={styles.fileName}>{file.path.split("/").pop()}</Text>
                <Text style={styles.filePath}>
                  {file.path} · {formatBytes(file.size)}
                </Text>
              </View>
              <Ionicons
                name={selected === file.path ? "chevron-up" : "chevron-down"}
                size={17}
                color={theme.colors.textMuted}
              />
            </Pressable>
            {selected === file.path && (
              <View style={styles.code}>
                <Text selectable style={styles.codeText}>
                  {content ?? "Loading…"}
                </Text>
              </View>
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
function Action({
  icon,
  label,
  danger,
  busy,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  danger?: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  return (
    <Pressable
      disabled={busy}
      onPress={onPress}
      style={[styles.action, danger && styles.actionDanger]}
    >
      {busy ? (
        <ActivityIndicator color={danger ? theme.colors.danger : theme.colors.text} />
      ) : (
        <Ionicons name={icon} size={19} color={danger ? theme.colors.danger : theme.colors.text} />
      )}
      <Text style={[styles.actionText, danger && { color: theme.colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    list: { padding: theme.space.md, gap: theme.space.md, paddingBottom: theme.space.xxxl },
    summary: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "center",
      gap: theme.space.sm,
      paddingVertical: theme.space.sm,
    },
    summaryValue: { color: theme.colors.text, fontSize: 20, fontWeight: "900" },
    summaryLabel: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 1,
    },
    summaryDivider: {
      width: 1,
      height: 20,
      backgroundColor: theme.colors.separator,
      marginHorizontal: theme.space.md,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      borderRadius: 16,
      padding: theme.space.md,
      gap: theme.space.md,
    },
    pressed: { opacity: 0.72 },
    cardTop: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
    appIcon: {
      width: 44,
      height: 44,
      borderRadius: 13,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surfaceRaised,
    },
    cardCopy: { flex: 1, minWidth: 0 },
    name: { color: theme.colors.text, fontSize: 16, fontWeight: "800" },
    description: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
      marginTop: theme.space.xs,
    },
    meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: theme.space.sm },
    dot: { width: 7, height: 7, borderRadius: 4 },
    status: {
      color: theme.colors.textSecondary,
      fontSize: 11,
      fontWeight: "700",
      textTransform: "capitalize",
    },
    metaText: { color: theme.colors.textMuted, fontSize: 11 },
    urlRow: { flexDirection: "row", alignItems: "center", gap: theme.space.xs },
    url: { color: theme.colors.accent, fontSize: 12, flexShrink: 1 },
    error: { color: theme.colors.danger, textAlign: "center" },
    empty: { alignItems: "center", paddingVertical: theme.space.massive, gap: theme.space.sm },
    emptyTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "800" },
    secondary: { color: theme.colors.textMuted, fontSize: 12 },
    detail: { padding: theme.space.md, gap: theme.space.lg, paddingBottom: theme.space.xxxl },
    hero: {
      backgroundColor: theme.colors.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      padding: theme.space.lg,
      gap: theme.space.md,
    },
    heroTop: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
    largeIcon: {
      width: 54,
      height: 54,
      borderRadius: 16,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surfaceRaised,
    },
    detailName: { color: theme.colors.text, fontSize: 22, fontWeight: "900" },
    openButton: {
      height: 44,
      borderRadius: 13,
      backgroundColor: theme.colors.accent,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.space.sm,
    },
    openButtonText: { color: theme.colors.accentText, fontSize: 13, fontWeight: "800" },
    metrics: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
    metric: {
      width: "48%",
      flexGrow: 1,
      backgroundColor: theme.colors.surface,
      borderRadius: 14,
      padding: theme.space.md,
      borderWidth: 1,
      borderColor: theme.colors.separator,
    },
    metricValue: { color: theme.colors.text, fontSize: 17, fontWeight: "800" },
    metricLabel: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 1,
      marginTop: theme.space.xs,
    },
    sectionTitle: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: "900",
      letterSpacing: 1.2,
      marginTop: theme.space.sm,
    },
    actions: { flexDirection: "row", gap: theme.space.sm },
    action: {
      flex: 1,
      height: 48,
      borderRadius: 14,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: theme.space.sm,
    },
    actionDanger: { borderColor: theme.colors.danger },
    actionText: { color: theme.colors.text, fontSize: 12, fontWeight: "800" },
    fileList: {
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      overflow: "hidden",
    },
    fileRow: {
      minHeight: 60,
      paddingHorizontal: theme.space.md,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    fileName: { color: theme.colors.text, fontSize: 13, fontWeight: "700" },
    filePath: { color: theme.colors.textMuted, fontSize: 10, marginTop: theme.space.xs },
    code: { backgroundColor: theme.colors.canvas, padding: theme.space.md, maxHeight: 360 },
    codeText: {
      color: theme.colors.textSecondary,
      fontSize: 11,
      lineHeight: 16,
      fontFamily: "monospace",
    },
  });
