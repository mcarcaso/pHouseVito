import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "../../services/api/client";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";

interface AuthStatus {
  hasAuth: boolean;
  authType: "api_key" | "oauth" | null;
  expiresAt?: number;
}
interface ProviderOverview {
  providers: string[];
  authStatus: Record<string, AuthStatus>;
  oauthProviders: Array<{ id: string; name: string }>;
}
interface Model {
  id: string;
  [key: string]: unknown;
}

export function ProvidersScreen({
  refreshKey,
  onOpen,
  onUnauthorized,
}: {
  refreshKey?: number;
  onOpen: (id: string) => void;
  onUnauthorized: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [overview, setOverview] = useState<ProviderOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    async (refresh = false) => {
      refresh ? setRefreshing(true) : setLoading(true);
      try {
        setOverview(await api<ProviderOverview>("/api/models/providers"));
        setError(null);
      } catch (cause) {
        if (cause instanceof Error && cause.message.includes("401")) onUnauthorized();
        else setError(cause instanceof Error ? cause.message : "Could not load providers");
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
  const login = async (id: string) => {
    setBusy(id);
    try {
      const result = await api<{
        status: string;
        url?: string;
        verificationUri?: string;
        userCode?: string;
      }>(`/api/auth/provider/${encodeURIComponent(id)}/login`, { method: "POST" });
      const url = result.url ?? result.verificationUri;
      if (result.userCode)
        Alert.alert(
          "Enter this device code",
          result.userCode,
          url
            ? [
                { text: "Open login page", onPress: () => void Linking.openURL(url) },
                { text: "Cancel", style: "cancel" },
              ]
            : undefined,
        );
      else if (url) await Linking.openURL(url);
      else if (result.status === "already_authenticated") await load(true);
    } catch (cause) {
      Alert.alert("Login failed", cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  };
  const logout = (id: string, name: string) =>
    Alert.alert(
      `Log out of ${name}?`,
      "Vito will no longer be able to use subscription authentication for this provider.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log out",
          style: "destructive",
          onPress: async () => {
            setBusy(id);
            try {
              await api(`/api/auth/provider/${encodeURIComponent(id)}/logout`, { method: "POST" });
              await load(true);
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  const providers = overview?.oauthProviders ?? [];
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
      <View style={styles.intro}>
        <Text style={styles.introTitle}>Model providers</Text>
        <Text style={styles.secondary}>Manage access and browse the models available to Vito.</Text>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {providers.map((provider) => {
        const status = overview?.authStatus[provider.id];
        const connected = status?.hasAuth === true;
        return (
          <Pressable
            key={provider.id}
            onPress={() => onOpen(provider.id)}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          >
            <View style={[styles.providerIcon, connected && styles.providerIconConnected]}>
              <Text style={styles.providerInitial}>{provider.name.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.copy}>
              <Text style={styles.name}>{provider.name}</Text>
              <View style={styles.statusRow}>
                <View style={[styles.dot, connected && styles.dotConnected]} />
                <Text style={[styles.status, connected && styles.statusConnected]}>
                  {connected
                    ? status?.authType === "oauth"
                      ? "Subscription connected"
                      : "API key configured"
                    : "Not connected"}
                </Text>
              </View>
            </View>
            <Pressable
              disabled={busy === provider.id}
              onPress={(event) => {
                event.stopPropagation();
                connected ? logout(provider.id, provider.name) : void login(provider.id);
              }}
              style={[styles.authButton, connected && styles.logoutButton]}
            >
              {busy === provider.id ? (
                <ActivityIndicator
                  size="small"
                  color={connected ? theme.colors.danger : theme.colors.accent}
                />
              ) : (
                <Text style={[styles.authButtonText, connected && styles.logoutText]}>
                  {connected ? "Log out" : "Log in"}
                </Text>
              )}
            </Pressable>
            <Ionicons name="chevron-forward" size={17} color={theme.colors.textMuted} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function ProviderModelsScreen({ id }: { id: string }) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [models, setModels] = useState<Model[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoading(true);
    void api<Model[]>(`/api/models/${encodeURIComponent(id)}`)
      .then((result) => {
        setModels(result);
        setError(null);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load models"))
      .finally(() => setLoading(false));
  }, [id]);
  const filtered = useMemo(
    () => models.filter((model) => model.id.toLowerCase().includes(query.trim().toLowerCase())),
    [models, query],
  );
  const groups = useMemo(() => {
    const result = new Map<string, Model[]>();
    for (const model of filtered) {
      const clean = model.id.includes("/") ? model.id.split("/").pop()! : model.id;
      const family = clean.split(/[-_.]/).slice(0, 2).join(" ");
      result.set(family, [...(result.get(family) ?? []), model]);
    }
    return [...result.entries()];
  }, [filtered]);
  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modelsContent}>
      <View style={styles.modelSummary}>
        <Text style={styles.modelCount}>{models.length}</Text>
        <Text style={styles.modelCountLabel}>models available</Text>
      </View>
      <View style={styles.search}>
        <Ionicons name="search-outline" size={18} color={theme.colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search models"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
        />
        {!!query && (
          <Pressable onPress={() => setQuery("")}>
            <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
          </Pressable>
        )}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {!error && !filtered.length && (
        <View style={styles.empty}>
          <Ionicons name="search-outline" size={30} color={theme.colors.textMuted} />
          <Text style={styles.name}>No matching models</Text>
        </View>
      )}
      {groups.map(([family, entries]) => (
        <View key={family} style={styles.group}>
          <Text style={styles.groupTitle}>{family.toUpperCase()}</Text>
          <View style={styles.modelList}>
            {entries.map((model) => {
              const short = model.id.includes("/") ? model.id.split("/").pop()! : model.id;
              return (
                <View key={model.id} style={styles.modelRow}>
                  <View style={styles.modelIcon}>
                    <Ionicons name="sparkles-outline" size={17} color={theme.colors.accent} />
                  </View>
                  <View style={styles.copy}>
                    <Text selectable style={styles.modelName}>
                      {short}
                    </Text>
                    {short !== model.id && (
                      <Text selectable style={styles.modelId}>
                        {model.id}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    list: { padding: theme.space.md, gap: theme.space.md, paddingBottom: theme.space.xxxl },
    intro: { paddingHorizontal: theme.space.xs, paddingVertical: theme.space.sm },
    introTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
    secondary: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 18,
      marginTop: theme.space.xs,
    },
    error: { color: theme.colors.danger, textAlign: "center", padding: theme.space.md },
    card: {
      minHeight: 76,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      padding: theme.space.md,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      backgroundColor: theme.colors.surface,
    },
    pressed: { opacity: 0.72 },
    providerIcon: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surfaceRaised,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
    },
    providerIconConnected: { borderColor: theme.colors.success },
    providerInitial: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
    copy: { flex: 1, minWidth: 0 },
    name: { color: theme.colors.text, fontSize: 14, fontWeight: "800" },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      marginTop: theme.space.xs,
    },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.textMuted },
    dotConnected: { backgroundColor: theme.colors.success },
    status: { color: theme.colors.textMuted, fontSize: 10 },
    statusConnected: { color: theme.colors.success },
    authButton: {
      minWidth: 58,
      height: 34,
      borderRadius: 10,
      paddingHorizontal: theme.space.sm,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.accentSurface,
    },
    logoutButton: { backgroundColor: theme.colors.dangerSurface },
    authButtonText: { color: theme.colors.accent, fontSize: 11, fontWeight: "800" },
    logoutText: { color: theme.colors.danger },
    modelsContent: {
      padding: theme.space.md,
      gap: theme.space.lg,
      paddingBottom: theme.space.xxxl,
    },
    modelSummary: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: theme.space.sm,
      paddingHorizontal: theme.space.xs,
    },
    modelCount: { color: theme.colors.text, fontSize: 28, fontWeight: "900" },
    modelCountLabel: { color: theme.colors.textMuted, fontSize: 12 },
    search: {
      height: 46,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: theme.space.md,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
    },
    searchInput: { flex: 1, color: theme.colors.text, fontSize: 14 },
    group: { gap: theme.space.sm },
    groupTitle: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "900",
      letterSpacing: 1.2,
      paddingHorizontal: theme.space.xs,
    },
    modelList: {
      borderWidth: 1,
      borderColor: theme.colors.separator,
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      overflow: "hidden",
    },
    modelRow: {
      minHeight: 62,
      paddingHorizontal: theme.space.md,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    modelIcon: {
      width: 34,
      height: 34,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.accentSurface,
    },
    modelName: { color: theme.colors.text, fontSize: 13, fontWeight: "700" },
    modelId: { color: theme.colors.textMuted, fontSize: 10, marginTop: theme.space.xs },
    empty: { alignItems: "center", gap: theme.space.sm, paddingVertical: theme.space.massive },
  });
