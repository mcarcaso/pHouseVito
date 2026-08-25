import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "../../services/api/client";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";

export type Secret = { key: string; value: string; system: boolean; description?: string };

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
  useEffect(() => {
    void api<Secret[]>("/api/secrets")
      .then(setSecrets)
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : "Could not load secrets";
        if (message.toLowerCase().includes("unauthorized")) onUnauthorized();
        setError(message);
      })
      .finally(() => setLoading(false));
  }, [onUnauthorized]);
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
        <Text style={secret.value ? styles.masked : styles.notSet}>
          {secret.value ? "••••••••" : "Not set"}
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

export function SecretEditorScreen({
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
  const [value, setValue] = useState(secret?.value ?? "");
  const [revealed, setRevealed] = useState(!secret);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const system = secret?.system === true;
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
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save secret");
    } finally {
      setSaving(false);
    }
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
      <View style={styles.field}>
        <View style={styles.valueHeading}>
          <Text style={styles.label}>Value</Text>
          <Pressable onPress={() => setRevealed((current) => !current)}>
            <Text style={styles.reveal}>{revealed ? "Hide" : "Reveal"}</Text>
          </Pressable>
        </View>
        <TextInput
          secureTextEntry={!revealed}
          autoCapitalize="none"
          autoCorrect={false}
          multiline={revealed}
          value={value}
          onChangeText={setValue}
          placeholder={system ? "Paste secret value" : "Secret value"}
          style={[styles.input, revealed && styles.valueInput]}
        />
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        disabled={saving || !key.trim()}
        onPress={() => void save()}
        style={[styles.saveButton, (saving || !key.trim()) && styles.disabled]}
      >
        <Text style={styles.saveText}>
          {saving ? "Saving…" : secret ? "Save Changes" : "Add Secret"}
        </Text>
      </Pressable>
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
    help: { color: theme.colors.textMuted, fontSize: 10, marginTop: theme.space.xs },
    valueHeading: { flexDirection: "row", justifyContent: "space-between" },
    reveal: { color: theme.colors.accent, fontSize: 11, fontWeight: "800" },
    valueInput: { minHeight: 110, textAlignVertical: "top" },
    saveButton: {
      alignItems: "center",
      backgroundColor: theme.colors.accent,
      borderRadius: 11,
      padding: theme.space.md,
    },
    disabled: { opacity: 0.45 },
    saveText: { color: theme.colors.accentText, fontWeight: "900" },
    deleteButton: { alignItems: "center", marginTop: theme.space.lg, padding: theme.space.md },
    deleteText: { color: theme.colors.danger, fontWeight: "800" },
  });
