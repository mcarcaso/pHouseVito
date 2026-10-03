import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "../../services/api/client";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";

export type Secret = {
  key: string;
  configured: boolean;
  system: boolean;
  description?: string;
};

// Notify mounted list panes without sharing secret values between screens.
const secretChangeListeners = new Set<() => void>();
function notifySecretsChanged() {
  for (const listener of secretChangeListeners) listener();
}

export function SecretsScreen({
  onOpen,
  onUnauthorized,
}: {
  onOpen: (secret: Secret) => void;
  onUnauthorized: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRequest = useRef(0);
  const loadSecrets = useCallback(() => {
    const request = ++loadRequest.current;
    void api<Secret[]>("/api/secrets", { cache: "no-store" })
      .then((items) => {
        if (request !== loadRequest.current) return;
        setSecrets(items);
        setError(null);
      })
      .catch((cause) => {
        if (request !== loadRequest.current) return;
        const message = cause instanceof Error ? cause.message : "Could not load secrets";
        if (message.toLowerCase().includes("unauthorized")) onUnauthorized();
        setError(message);
      })
      .finally(() => {
        if (request === loadRequest.current) setLoading(false);
      });
  }, [onUnauthorized]);
  useFocusEffect(
    useCallback(() => {
      loadSecrets();
    }, [loadSecrets]),
  );
  useEffect(() => {
    secretChangeListeners.add(loadSecrets);
    return () => {
      secretChangeListeners.delete(loadSecrets);
      loadRequest.current++;
    };
  }, [loadSecrets]);
  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  const builtIn = secrets.filter((secret) => secret.system);
  const custom = secrets.filter((secret) => !secret.system);
  const renderSecret = (secret: Secret) => (
    <Pressable key={secret.key} onPress={() => onOpen(secret)} style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.key}>{secret.key}</Text>
        {secret.description && (
          <Text numberOfLines={2} style={styles.description}>
            {secret.description}
          </Text>
        )}
        <Text style={secret.configured ? styles.masked : styles.notSet}>
          {secret.configured ? "••••••••" : "Not set"}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
    </Pressable>
  );
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.list}>
      {error && <Text style={styles.error}>{error}</Text>}
      <Text style={styles.sectionTitle}>Built-in</Text>
      {builtIn.map(renderSecret)}
      <Text style={[styles.sectionTitle, styles.customSection]}>Custom</Text>
      {custom.length ? (
        custom.map(renderSecret)
      ) : (
        <Text style={styles.empty}>No custom secrets</Text>
      )}
    </ScrollView>
  );
}

export function SecretEditorScreen(props: {
  secret?: Secret;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  return <SecretEditorForm key={props.secret?.key ?? "new"} {...props} />;
}

function SecretEditorForm({
  secret,
  onSaved,
  onDeleted,
}: {
  secret?: Secret;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const [key, setKey] = useState(secret?.key ?? "");
  const [value, setValue] = useState("");
  const [revealed, setRevealed] = useState(!secret);
  const [saving, setSaving] = useState(false);
  const [issuingDrop, setIssuingDrop] = useState(false);
  const [dropUrl, setDropUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storedValue, setStoredValue] = useState<string | null>(null);
  const [revealingStored, setRevealingStored] = useState(false);
  const revealRequest = useRef(0);
  const system = secret?.system === true;
  const hideStored = useCallback(() => {
    revealRequest.current++;
    setStoredValue(null);
    setRevealingStored(false);
  }, []);
  useFocusEffect(useCallback(() => () => hideStored(), [hideStored]));
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") hideStored();
    });
    return () => subscription.remove();
  }, [hideStored]);
  const revealStored = async () => {
    if (!secret?.configured) return;
    const request = ++revealRequest.current;
    setRevealingStored(true);
    setError(null);
    try {
      const result = await api<{ value: string }>(
        `/api/secrets/${encodeURIComponent(secret.key)}/reveal`,
        { method: "POST", body: "{}", cache: "no-store" },
      );
      if (request === revealRequest.current) setStoredValue(result.value);
    } catch (cause) {
      if (request === revealRequest.current)
        setError(cause instanceof Error ? cause.message : "Could not reveal secret");
    } finally {
      if (request === revealRequest.current) setRevealingStored(false);
    }
  };
  const save = async () => {
    const nextKey = key.trim();
    if (!nextKey) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/api/secrets/${encodeURIComponent(nextKey)}`, {
        method: "PUT",
        body: JSON.stringify({ value }),
      });
      if (secret && !system && nextKey !== secret.key)
        await api(`/api/secrets/${encodeURIComponent(secret.key)}`, { method: "DELETE" });
      notifySecretsChanged();
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save secret");
    } finally {
      setSaving(false);
    }
  };
  const issueDrop = async (replace: boolean) => {
    const nextKey = key.trim();
    if (!nextKey) return;
    setIssuingDrop(true);
    setDropUrl(null);
    setError(null);
    try {
      const drop = await api<{ url: string }>("/api/secret-drops", {
        method: "POST",
        body: JSON.stringify({ key: nextKey, replace }),
      });
      setDropUrl(drop.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create secret-drop link");
    } finally {
      setIssuingDrop(false);
    }
  };
  const createDrop = () => {
    if (!secret?.configured) {
      void issueDrop(false);
      return;
    }
    Alert.alert(
      "Create replacement link",
      `This link can replace the stored value for ${secret.key}. Continue?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Create Link", onPress: () => void issueDrop(true) },
      ],
    );
  };
  const clear = () => {
    if (!secret?.configured || !system) return;
    Alert.alert("Clear secret", `Clear the stored value for ${secret.key}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/api/secrets/${encodeURIComponent(secret.key)}`, {
              method: "PUT",
              body: JSON.stringify({ value: "" }),
            });
            notifySecretsChanged();
            onSaved();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not clear secret");
          }
        },
      },
    ]);
  };
  const remove = () => {
    if (!secret || system) return;
    Alert.alert("Delete secret", `Delete ${secret.key}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/api/secrets/${encodeURIComponent(secret.key)}`, { method: "DELETE" });
            notifySecretsChanged();
            onDeleted?.();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not delete secret");
          }
        },
      },
    ]);
  };
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.editor}
    >
      {secret?.description && <Text style={styles.editorDescription}>{secret.description}</Text>}
      <View style={styles.field}>
        <Text style={styles.label}>Key</Text>
        <TextInput
          editable={!system}
          autoCapitalize="characters"
          autoCorrect={false}
          value={key}
          onChangeText={(text) => setKey(text.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
          placeholder="KEY_NAME"
          style={[styles.input, system && styles.inputLocked]}
        />
        {system && <Text style={styles.help}>Built-in keys cannot be renamed.</Text>}
      </View>
      {secret?.configured && (
        <View style={styles.field}>
          <View style={styles.valueHeading}>
            <Text style={styles.label}>Stored value</Text>
            <Pressable
              accessibilityRole="button"
              disabled={revealingStored}
              onPress={storedValue === null ? () => void revealStored() : hideStored}
            >
              <Text style={styles.reveal}>
                {revealingStored ? "Revealing…" : storedValue === null ? "Reveal" : "Hide"}
              </Text>
            </Pressable>
          </View>
          <Text selectable={storedValue !== null} style={styles.storedValue}>
            {storedValue ?? "••••••••"}
          </Text>
        </View>
      )}
      <View style={styles.field}>
        <View style={styles.valueHeading}>
          <Text style={styles.label}>{secret?.configured ? "Replacement value" : "Value"}</Text>
          <Pressable onPress={() => setRevealed((current) => !current)}>
            <Text style={styles.reveal}>{revealed ? "Hide input" : "Show input"}</Text>
          </Pressable>
        </View>
        <TextInput
          secureTextEntry={!revealed}
          autoCapitalize="none"
          autoCorrect={false}
          multiline={revealed}
          value={value}
          onChangeText={setValue}
          placeholder={secret?.configured ? "Enter a new value to replace it" : "Secret value"}
          style={[styles.input, revealed && styles.valueInput]}
        />
        {secret?.configured && (
          <Text style={styles.help}>
            Leave this blank unless you want to replace the stored value.
          </Text>
        )}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        disabled={issuingDrop || !key.trim()}
        onPress={createDrop}
        style={[styles.dropButton, (issuingDrop || !key.trim()) && styles.disabled]}
      >
        <Text style={styles.dropText}>
          {issuingDrop ? "Creating…" : "Create 15-Minute Secret Link"}
        </Text>
      </Pressable>
      {dropUrl && (
        <View style={styles.dropResult}>
          <Text selectable style={styles.dropUrl}>
            {dropUrl}
          </Text>
          <Pressable onPress={() => void Clipboard.setStringAsync(dropUrl)}>
            <Text style={styles.reveal}>Copy Link</Text>
          </Pressable>
        </View>
      )}
      <Pressable
        disabled={saving || !key.trim() || !value}
        onPress={() => void save()}
        style={[styles.saveButton, (saving || !key.trim() || !value) && styles.disabled]}
      >
        <Text style={styles.saveText}>
          {saving ? "Saving…" : secret ? "Save Changes" : "Add Secret"}
        </Text>
      </Pressable>
      {secret?.configured && system && (
        <Pressable onPress={clear} style={styles.deleteButton}>
          <Text style={styles.deleteText}>Clear Stored Value</Text>
        </Pressable>
      )}
      {secret && !system && (
        <Pressable onPress={remove} style={styles.deleteButton}>
          <Text style={styles.deleteText}>Delete Secret</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    workspace: { flex: 1 },
    workspaceHeader: {
      height: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.space.lg,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    workspaceHeading: { flex: 1, flexDirection: "row", alignItems: "center", gap: theme.space.sm },
    desktopBack: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
    workspaceTitle: { flex: 1, color: theme.colors.text, fontSize: 15, fontWeight: "700" },
    desktopAdd: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 20,
      backgroundColor: theme.colors.accentSurface,
    },
    workspaceBody: { flex: 1 },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    row: {
      minHeight: 76,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
      paddingVertical: theme.space.md,
    },
    rowMain: { flex: 1 },
    key: { color: theme.colors.text, fontFamily: "monospace", fontSize: 13, fontWeight: "800" },
    description: {
      color: theme.colors.textMuted,
      fontSize: 11,
      lineHeight: 16,
      marginTop: theme.space.xs,
    },
    masked: {
      color: theme.colors.textMuted,
      fontSize: 11,
      letterSpacing: 1.5,
      marginTop: theme.space.xs,
    },
    notSet: {
      color: theme.colors.warning,
      fontSize: 10,
      fontWeight: "800",
      marginTop: theme.space.xs,
    },
    list: { paddingHorizontal: theme.space.lg, paddingBottom: theme.space.xxxl },
    error: { color: theme.colors.danger, marginBottom: theme.space.md },
    sectionTitle: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "900",
      letterSpacing: 1.2,
      textTransform: "uppercase",
      paddingTop: theme.space.xl,
      paddingBottom: theme.space.sm,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    customSection: { marginTop: theme.space.lg },
    empty: {
      color: theme.colors.textMuted,
      fontSize: 12,
      textAlign: "center",
      paddingVertical: theme.space.xxl,
    },
    editor: {
      padding: theme.space.xl,
      paddingBottom: theme.space.xxxl,
      maxWidth: 640,
      width: "100%",
    },
    editorDescription: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      paddingBottom: theme.space.lg,
      marginBottom: theme.space.xl,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    field: { marginBottom: theme.space.xl },
    label: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      fontWeight: "800",
      marginBottom: theme.space.sm,
    },
    input: {
      color: theme.colors.text,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      borderRadius: 11,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.md,
      fontFamily: "monospace",
    },
    inputLocked: { color: theme.colors.textMuted, backgroundColor: theme.colors.canvas },
    storedValue: {
      color: theme.colors.text,
      fontFamily: "monospace",
      fontSize: 13,
      paddingVertical: theme.space.sm,
    },
    help: { color: theme.colors.textMuted, fontSize: 10, marginTop: theme.space.xs },
    valueHeading: { flexDirection: "row", justifyContent: "space-between" },
    reveal: { color: theme.colors.accent, fontSize: 11, fontWeight: "800" },
    valueInput: { minHeight: 110, textAlignVertical: "top" },
    dropButton: {
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.accent,
    },
    dropText: { color: theme.colors.accent, fontWeight: "800" },
    dropResult: {
      marginTop: theme.space.md,
      padding: theme.space.md,
      gap: theme.space.sm,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
    },
    dropUrl: { color: theme.colors.text, fontFamily: "monospace", fontSize: 11 },
    saveButton: {
      alignItems: "center",
      marginTop: theme.space.lg,
      backgroundColor: theme.colors.accent,
      borderRadius: 11,
      padding: theme.space.md,
    },
    disabled: { opacity: 0.45 },
    saveText: { color: theme.colors.accentText, fontWeight: "900" },
    deleteButton: { alignItems: "center", marginTop: theme.space.lg, padding: theme.space.md },
    deleteText: { color: theme.colors.danger, fontWeight: "800" },
  });
