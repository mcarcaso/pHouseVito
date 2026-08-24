import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../../services/api/client";
import { MarkdownText } from "../../components/markdown/MarkdownText";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";

export type MobileSkill = { name: string; description: string; source: "builtin" | "user" };
export type MobileSkillFile = { name: string; path: string; size: number };
type FileContent = { name: string; size: number; content: string | null; binary: boolean };

export function SkillDocumentScreen({ name, description }: { name: string; description?: string }) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [file, setFile] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setFile(null);
    setError(null);
    void readSkillFile(name, "SKILL.md")
      .then(setFile)
      .catch((cause) => setError(message(cause)));
  }, [name]);
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.document}>
      {!file && !error && <ActivityIndicator color={theme.colors.accent} />}
      {error && <Text style={styles.error}>{error}</Text>}
      {description && <Text style={styles.skillDescription}>{description}</Text>}
      {file?.content && <MarkdownText>{stripFrontmatter(file.content)}</MarkdownText>}
    </ScrollView>
  );
}

export function SkillFilesScreen({
  name,
  onOpen,
}: {
  name: string;
  onOpen: (file: string) => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [files, setFiles] = useState<MobileSkillFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setFiles([]);
    setError(null);
    void api<MobileSkillFile[]>(`/api/skills/${encodeURIComponent(name)}/files`)
      .then(setFiles)
      .catch((cause) => setError(message(cause)));
  }, [name]);
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.files}>
      {!files.length && !error && <ActivityIndicator color={theme.colors.accent} />}
      {error && <Text style={styles.error}>{error}</Text>}
      {files.map((file) => (
        <Pressable key={file.name} onPress={() => onOpen(file.name)} style={styles.fileRow}>
          <Ionicons
            name={file.name.endsWith(".md") ? "document-text-outline" : "document-outline"}
            size={19}
            color={theme.colors.textMuted}
          />
          <Text numberOfLines={1} style={styles.fileName}>
            {file.name}
          </Text>
          <Text style={styles.fileSize}>{formatSize(file.size)}</Text>
          <Ionicons name="chevron-forward" size={17} color={theme.colors.textMuted} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function SkillFileScreen({ name, fileName }: { name: string; fileName: string }) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [file, setFile] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setFile(null);
    setError(null);
    void readSkillFile(name, fileName)
      .then(setFile)
      .catch((cause) => setError(message(cause)));
  }, [fileName, name]);
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.document}>
      {!file && !error && <ActivityIndicator color={theme.colors.accent} />}
      {error && <Text style={styles.error}>{error}</Text>}
      {file?.content &&
        (file.name.endsWith(".md") ? (
          <MarkdownText>{stripFrontmatter(file.content)}</MarkdownText>
        ) : (
          <Text selectable style={styles.code}>
            {file.content}
          </Text>
        ))}
      {file?.binary && <Text style={styles.muted}>This file cannot be previewed.</Text>}
    </ScrollView>
  );
}

function stripFrontmatter(content: string) {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
}

function readSkillFile(name: string, fileName: string) {
  return api<FileContent>(
    `/api/skills/${encodeURIComponent(name)}/file?path=${encodeURIComponent(fileName)}`,
  );
}
function message(cause: unknown) {
  return cause instanceof Error ? cause.message : "Could not load skill file";
}
function formatSize(size: number) {
  return size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
}
const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    document: { padding: theme.space.xl, paddingBottom: theme.space.xxxl },
    files: { paddingHorizontal: theme.space.lg, paddingBottom: theme.space.xxxl },
    fileRow: {
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    fileName: { flex: 1, color: theme.colors.text, fontFamily: "monospace", fontSize: 12 },
    fileSize: { color: theme.colors.textMuted, fontSize: 10 },
    code: {
      color: theme.colors.textSecondary,
      fontFamily: "monospace",
      fontSize: 11,
      lineHeight: 18,
    },
    skillDescription: {
      color: theme.colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
      paddingBottom: theme.space.lg,
      marginBottom: theme.space.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    error: { color: theme.colors.danger },
    muted: { color: theme.colors.textMuted },
  });
