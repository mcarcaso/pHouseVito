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
import { createSkillsStyles } from "./styles";
import { StyleSheet } from "react-native";

type Skill = { name: string; description: string; source: "builtin" | "user" };
type SkillFile = { name: string; path: string; size: number };
type FileContent = { name: string; size: number; content: string | null; binary: boolean };

export function SkillsScreen({
  onUnauthorized,
  onOpenSkill,
}: {
  onUnauthorized: () => void;
  onOpenSkill?: (skill: Skill) => void;
}) {
  const styles = useThemeStyles(createSkillsStyles);
  const theme = useVitoTheme();
  const desktop = useWindowDimensions().width >= DESKTOP_BREAKPOINT;
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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? skills.filter((skill) =>
          `${skill.name} ${skill.description}`.toLowerCase().includes(needle),
        )
      : skills;
  }, [query, skills]);

  const skillList = (
    <View style={styles.skillPane}>
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
            onPress={() => (onOpenSkill && !desktop ? onOpenSkill(skill) : void openSkill(skill))}
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
  );
}

function stripFrontmatter(content: string) {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
}
function formatSize(size: number) {
  return size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
}
