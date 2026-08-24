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
import { createSecretsStyles } from "./styles";

export type Secret = { key: string; value: string; system: boolean; description?: string };

export function DesktopSecretsScreen({ onUnauthorized }: { onUnauthorized: () => void }) {
  const styles = useThemeStyles(createSecretsStyles);
  const theme = useVitoTheme();
  const [selected, setSelected] = useState<Secret | "new" | null>(null);
  const [version, setVersion] = useState(0);
  const close = () => {
    setSelected(null);
    setVersion((value) => value + 1);
  };
  return (
    <View style={styles.workspace}>
      <View style={styles.workspaceHeader}>
        <View style={styles.workspaceHeading}>
          {selected && (
            <Pressable onPress={() => setSelected(null)} style={styles.desktopBack}>
              <Ionicons name="chevron-back" size={22} color={theme.colors.accent} />
            </Pressable>
          )}
          <Text style={styles.workspaceTitle}>
            {selected === "new" ? "New Secret" : selected ? selected.key : "Secrets"}
          </Text>
        </View>
        {!selected && (
          <Pressable
            accessibilityLabel="Add secret"
            onPress={() => setSelected("new")}
            style={styles.desktopAdd}
          >
            <Ionicons name="add" size={24} color={theme.colors.accent} />
          </Pressable>
        )}
      </View>
      <View style={styles.workspaceBody}>
        {selected === "new" ? (
          <SecretEditorScreen onSaved={close} />
        ) : selected ? (
          <SecretEditorScreen secret={selected} onSaved={close} onDeleted={close} />
        ) : (
          <SecretsScreen key={version} onOpen={setSelected} onUnauthorized={onUnauthorized} />
        )}
      </View>
    </View>
  );
}

export function SecretsScreen({
  onOpen,
  onUnauthorized,
}: {
  onOpen: (secret: Secret) => void;
  onUnauthorized: () => void;
}) {
  const styles = useThemeStyles(createSecretsStyles);
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
  const styles = useThemeStyles(createSecretsStyles);
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
