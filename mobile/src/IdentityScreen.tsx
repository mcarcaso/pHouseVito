import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "./api";
import { MarkdownText } from "./MarkdownText";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "./theme";

export type IdentityDocument = "profile" | "soul" | "instructions";

const documents: Array<{
  id: IdentityDocument;
  title: string;
  description: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  path: string;
  editable: boolean;
}> = [
  {
    id: "profile",
    title: "Profile",
    description: "What Vito knows about Mike",
    icon: "person-outline",
    path: "/api/memory/profile",
    editable: false,
  },
  {
    id: "soul",
    title: "Soul",
    description: "Vito’s personality and values",
    icon: "heart-outline",
    path: "/api/soul",
    editable: true,
  },
  {
    id: "instructions",
    title: "Instructions",
    description: "Core operating rules",
    icon: "document-text-outline",
    path: "/api/system-prompt",
    editable: false,
  },
];

export function IdentityHome({ onOpen }: { onOpen: (document: IdentityDocument) => void }) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  return (
    <ScrollView contentContainerStyle={styles.home}>
      <View style={styles.documentList}>
        {documents.map((document) => (
          <Pressable key={document.id} onPress={() => onOpen(document.id)} style={styles.row}>
            <Ionicons name={document.icon} size={20} color={theme.colors.accent} />
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{document.title}</Text>
              <Text style={styles.rowDescription}>{document.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={theme.colors.textMuted} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

export function IdentityDocumentScreen({ document }: { document: IdentityDocument }) {
  const styles = useThemeStyles(createStyles);
  const definition = documents.find((item) => item.id === document)!;
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api<{ content?: unknown }>(definition.path);
      const next = typeof response.content === "string" ? response.content : "";
      setContent(next);
      setDraft(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load document");
    } finally {
      setLoading(false);
    }
  }, [definition.path]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await api<{ content?: unknown }>(definition.path, {
        method: "PUT",
        body: JSON.stringify({ content: draft }),
      });
      const next = typeof response.content === "string" ? response.content : draft;
      setContent(next);
      setDraft(next);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save document");
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );

  return (
    <ScrollView contentContainerStyle={styles.document}>
      {definition.editable && (
        <View style={styles.actions}>
          {editing ? (
            <>
              <Pressable
                onPress={() => {
                  setDraft(content);
                  setEditing(false);
                }}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable disabled={saving} onPress={() => void save()} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>{saving ? "Saving…" : "Save"}</Text>
              </Pressable>
            </>
          ) : (
            <Pressable onPress={() => setEditing(true)} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Edit Markdown</Text>
            </Pressable>
          )}
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {editing ? (
        <TextInput
          multiline
          autoCapitalize="sentences"
          autoCorrect={false}
          value={draft}
          onChangeText={setDraft}
          style={styles.editor}
          textAlignVertical="top"
        />
      ) : (
        <MarkdownText>{content}</MarkdownText>
      )}
    </ScrollView>
  );
}

export function identityDocumentTitle(document: IdentityDocument): string {
  return documents.find((item) => item.id === document)?.title ?? "Identity";
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    home: { width: "100%", maxWidth: 760, alignSelf: "center", padding: theme.space.xl },
    eyebrow: { color: theme.colors.accent, fontSize: 9, fontWeight: "800", letterSpacing: 1.4 },
    heading: {
      color: theme.colors.text,
      fontSize: 30,
      fontWeight: "800",
      marginTop: theme.space.sm,
    },
    intro: { color: theme.colors.textMuted, fontSize: 14, marginTop: theme.space.sm },
    documentList: {
      borderTopWidth: 1,
      borderTopColor: theme.colors.separator,
    },
    row: {
      minHeight: 72,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    rowCopy: { flex: 1 },
    rowTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "700" },
    rowDescription: { color: theme.colors.textMuted, fontSize: 12, marginTop: theme.space.xs },
    centered: { flex: 1, alignItems: "center", justifyContent: "center" },
    document: {
      width: "100%",
      maxWidth: 860,
      alignSelf: "center",
      padding: theme.space.xl,
      paddingBottom: theme.space.huge,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: theme.space.sm,
      marginBottom: theme.space.xl,
    },
    primaryButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: 10,
      paddingHorizontal: theme.space.lg,
      paddingVertical: theme.space.sm,
    },
    primaryButtonText: { color: theme.colors.accentText, fontSize: 12, fontWeight: "800" },
    secondaryButton: {
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      borderRadius: 10,
      paddingHorizontal: theme.space.lg,
      paddingVertical: theme.space.sm,
    },
    secondaryButtonText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: "700" },
    editor: {
      minHeight: 560,
      color: theme.colors.text,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      borderRadius: 12,
      padding: theme.space.lg,
      fontSize: 13,
      lineHeight: 20,
    },
    error: { color: theme.colors.danger, marginBottom: theme.space.md },
  });
