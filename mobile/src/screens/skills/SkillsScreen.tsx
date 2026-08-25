import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { api } from "../../services/api/client";
import { MarkdownText } from "../../components/markdown/MarkdownText";
import {
  DESKTOP_BREAKPOINT,
  useThemeStyles,
  useVitoTheme,
  type VitoTheme,
} from "../../hooks/useVitoTheme";
import { StyleSheet } from "react-native";

type Skill = { name: string; description: string; source: "builtin" | "user" };
type SkillFile = { name: string; path: string; size: number };
type FileContent = { name: string; size: number; content: string | null; binary: boolean };

export function SkillsScreen({
  onUnauthorized,
  onOpenSkill,
  selectedName,
}: {
  onUnauthorized: () => void;
  onOpenSkill?: (skill: Skill) => void;
  selectedName?: string | null;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const desktop = false;
  const [skills, setSkills] = useState<Skill[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Skill | null>(null);
  const [files, setFiles] = useState<SkillFile[]>([]);
  const [file, setFile] = useState<FileContent | null>(null);
  const [mobileFiles, setMobileFiles] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<Skill[]>("/api/skills")
      .then(setSkills)
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : "Could not load skills";
        if (message.toLowerCase().includes("unauthorized")) onUnauthorized();
        setError(message);
      })
      .finally(() => setLoading(false));
  }, [onUnauthorized]);

  const openFile = async (skill: Skill, name: string) => {
    setLoading(true);
    setError(null);
    try {
      setFile(
        await api<FileContent>(
          `/api/skills/${encodeURIComponent(skill.name)}/file?path=${encodeURIComponent(name)}`,
        ),
      );
      if (!desktop) setMobileFiles(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load file");
    } finally {
      setLoading(false);
    }
  };

  const openSkill = async (skill: Skill) => {
    setSelected(skill);
    setMobileFiles(false);
    setFile(null);
    setLoading(true);
    setError(null);
    try {
      const nextFiles = await api<SkillFile[]>(
        `/api/skills/${encodeURIComponent(skill.name)}/files`,
      );
      setFiles(nextFiles);
      await openFile(skill, "SKILL.md");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load skill");
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedName) {
      if (onOpenSkill) setSelected(null);
      return;
    }
    if (selected?.name === selectedName) return;
    const skill = skills.find((item) => item.name === selectedName);
    if (skill) void openSkill(skill);
  }, [selectedName, skills, selected?.name, onOpenSkill]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? skills.filter((skill) =>
          `${skill.name} ${skill.description}`.toLowerCase().includes(needle),
        )
      : skills;
  }, [query, skills]);

  const skillList = (
    <View style={[styles.skillPane, desktop && styles.desktopSkillPane]}>
      <Text style={styles.count}>{skills.length} capabilities</Text>
      <View style={styles.search}>
        <Ionicons name="search-outline" size={17} color={theme.colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search skills"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.searchInput}
        />
      </View>
      <ScrollView style={styles.skillList}>
        {filtered.map((skill) => (
          <Pressable
            key={skill.name}
            onPress={() => {
              onOpenSkill?.(skill);
              if (desktop || !onOpenSkill) void openSkill(skill);
            }}
            style={[styles.skillRow, selected?.name === skill.name && styles.skillRowActive]}
          >
            <View style={styles.skillRowTop}>
              <Text style={styles.skillName}>{skill.name}</Text>
              <Text style={styles.source}>{skill.source === "builtin" ? "BUILT-IN" : "USER"}</Text>
            </View>
            <Text numberOfLines={2} style={styles.description}>
              {skill.description}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );

  const fileList = selected && (
    <View style={styles.filePane}>
      {!desktop && (
        <View style={styles.mobileHeader}>
          <Pressable onPress={() => setMobileFiles(false)}>
            <Ionicons name="chevron-back" size={25} color={theme.colors.accent} />
          </Pressable>
          <Text numberOfLines={1} style={styles.mobileTitle}>
            {selected.name} files
          </Text>
          <View style={styles.headerSpacer} />
        </View>
      )}
      <Text style={styles.fileHeading}>SKILL FILES</Text>
      <ScrollView>
        {files.map((item) => (
          <Pressable
            key={item.name}
            onPress={() => void openFile(selected, item.name)}
            style={[styles.fileRow, file?.name === item.name && styles.fileRowActive]}
          >
            <Ionicons
              name={item.name.endsWith(".md") ? "document-text-outline" : "document-outline"}
              size={16}
              color={file?.name === item.name ? theme.colors.accent : theme.colors.textMuted}
            />
            <Text numberOfLines={1} style={styles.fileName}>
              {item.name}
            </Text>
            <Text style={styles.fileSize}>{formatSize(item.size)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );

  const viewer = selected && (
    <View style={styles.viewer}>
      {!desktop && (
        <View style={styles.mobileHeader}>
          <Pressable
            onPress={() => {
              setSelected(null);
              setFile(null);
            }}
          >
            <Ionicons name="chevron-back" size={25} color={theme.colors.accent} />
          </Pressable>
          <Text numberOfLines={1} style={styles.mobileTitle}>
            {selected.name}
          </Text>
          <Pressable
            accessibilityLabel="Browse skill files"
            onPress={() => setMobileFiles(true)}
            style={styles.folderButton}
          >
            <Ionicons name="folder-open-outline" size={22} color={theme.colors.accent} />
          </Pressable>
        </View>
      )}
      {desktop && file && (
        <View style={styles.fileBar}>
          <Text style={styles.currentFile}>{file.name}</Text>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.viewerContent}>
        {loading && <ActivityIndicator color={theme.colors.accent} />}
        {error && <Text style={styles.error}>{error}</Text>}
        {!loading &&
          file?.content &&
          (file.name.endsWith(".md") ? (
            <MarkdownText>{stripFrontmatter(file.content)}</MarkdownText>
          ) : (
            <Text selectable style={styles.code}>
              {file.content}
            </Text>
          ))}
        {!loading && file?.binary && (
          <Text style={styles.empty}>This file cannot be previewed.</Text>
        )}
      </ScrollView>
    </View>
  );

  if (!desktop) {
    if (mobileFiles) return fileList;
    if (selected) return viewer;
    return skillList;
  }
  return (
    <View style={styles.desktop}>
      {skillList}
      <View style={styles.detailPane}>
        {selected ? (
          <>
            {fileList}
            {viewer}
          </>
        ) : (
          <View style={styles.emptyPane}>
            <Text style={styles.empty}>Select a skill to read its documentation.</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function stripFrontmatter(content: string) {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
}
function formatSize(size: number) {
  return size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    skillPane: { flex: 1, minWidth: 0 },
    desktopSkillPane: {
      flexGrow: 0,
      flexShrink: 0,
      flexBasis: 360,
      width: 360,
      minWidth: 360,
      maxWidth: 360,
      borderRightWidth: 1,
      borderRightColor: theme.colors.separator,
    },
    count: {
      color: theme.colors.textMuted,
      fontSize: 11,
      marginHorizontal: theme.space.xl,
      marginTop: theme.space.lg,
    },
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      marginHorizontal: theme.space.xl,
      marginTop: theme.space.sm,
      marginBottom: theme.space.md,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      borderRadius: 11,
      paddingHorizontal: theme.space.md,
    },
    searchInput: { flex: 1, color: theme.colors.text, paddingVertical: theme.space.md },
    skillList: { flex: 1 },
    skillRow: {
      paddingHorizontal: theme.space.xl,
      paddingVertical: theme.space.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    skillRowActive: {
      backgroundColor: theme.colors.accentSurface,
      borderLeftWidth: 2,
      borderLeftColor: theme.colors.accent,
    },
    skillRowTop: { flexDirection: "row", justifyContent: "space-between", gap: theme.space.sm },
    skillName: { color: theme.colors.text, fontSize: 13, fontWeight: "800", flex: 1 },
    source: { color: theme.colors.textMuted, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
    description: {
      color: theme.colors.textMuted,
      fontSize: 11,
      lineHeight: 16,
      marginTop: theme.space.xs,
    },
    filePane: {
      width: 230,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: theme.colors.separator,
      paddingTop: theme.space.xl,
    },
    mobileHeader: {
      height: 54,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      paddingHorizontal: theme.space.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    mobileTitle: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "800",
      textAlign: "center",
    },
    headerSpacer: { width: 25 },
    fileHeading: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "900",
      letterSpacing: 1.2,
      marginHorizontal: theme.space.md,
      marginBottom: theme.space.sm,
    },
    fileRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.sm,
    },
    fileRowActive: { backgroundColor: theme.colors.accentSurface },
    fileName: { flex: 1, color: theme.colors.textSecondary, fontFamily: "monospace", fontSize: 10 },
    fileSize: { color: theme.colors.textMuted, fontSize: 9 },
    viewer: { flex: 2, minWidth: 0 },
    folderButton: { width: 32, alignItems: "flex-end" },
    fileBar: {
      height: 48,
      justifyContent: "center",
      paddingHorizontal: theme.space.xl,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    currentFile: { color: theme.colors.textMuted, fontFamily: "monospace", fontSize: 11 },
    viewerContent: { padding: theme.space.xl, paddingBottom: theme.space.xxxl },
    error: { color: theme.colors.danger },
    code: {
      color: theme.colors.textSecondary,
      fontFamily: "monospace",
      fontSize: 11,
      lineHeight: 18,
    },
    empty: { color: theme.colors.textMuted, fontSize: 12 },
    desktop: { flex: 1, flexDirection: "row" },
    detailPane: { flex: 1, minWidth: 0, flexDirection: "row" },
    emptyPane: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      borderLeftWidth: 1,
      borderLeftColor: theme.colors.separator,
    },
  });
