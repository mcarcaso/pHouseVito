import Markdown, { type ASTNode, type RenderRules } from "react-native-markdown-display";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useMemo } from "react";
import { useThemeStyles, type VitoTheme } from "./theme";

const rules: RenderRules = {
  text: (node: ASTNode, _children, parents, styles) => {
    const types = new Set(parents.map((parent) => parent.type));
    const style = types.has("link")
      ? styles.link
      : types.has("code_inline")
        ? styles.code_inline
        : types.has("heading1")
          ? styles.heading1
          : types.has("heading2")
            ? styles.heading2
            : types.has("heading3")
              ? styles.heading3
              : types.has("strong")
                ? styles.strong
                : styles.text;
    return (
      <Text key={node.key} selectable style={style}>
        {node.content}
      </Text>
    );
  },
  paragraph: (node: ASTNode, children, parents, styles) => (
    <View
      key={node.key}
      style={[
        styles.paragraph,
        parents.some((parent) => parent.type === "list_item") && styles.paragraphInList,
      ]}
    >
      {children}
    </View>
  ),
  code_block: (node: ASTNode, _children, _parents, styles) => (
    <View key={node.key} style={styles.codeBlock}>
      <Text selectable style={styles.codeText}>
        {node.content.replace(/\n$/, "")}
      </Text>
    </View>
  ),
  fence: (node: ASTNode, _children, _parents, styles) => (
    <View key={node.key} style={styles.codeBlock}>
      <Text selectable style={styles.codeText}>
        {node.content.replace(/\n$/, "")}
      </Text>
    </View>
  ),
  table: (node: ASTNode, children, _parents, styles) => (
    <ScrollView key={node.key} horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.table}>{children}</View>
    </ScrollView>
  ),
};

export function MarkdownText({
  children,
  tone = "default",
  variant = "document",
}: {
  children: string;
  tone?: "default" | "onAccent";
  variant?: "document" | "chat";
}) {
  const styles = useThemeStyles(createStyles);
  const markdownStyles = useMemo(
    () => ({
      ...styles,
      body: StyleSheet.flatten([
        styles.body,
        variant === "chat" && styles.bodyChat,
        tone === "onAccent" && styles.bodyOnAccent,
      ]),
      text: StyleSheet.flatten([styles.text, tone === "onAccent" && styles.textOnAccent]),
      paragraph: StyleSheet.flatten([styles.paragraph, variant === "chat" && styles.paragraphChat]),
      heading1: StyleSheet.flatten([
        styles.heading1,
        variant === "chat" && styles.heading1Chat,
        tone === "onAccent" && styles.headingOnAccent,
      ]),
      heading2: StyleSheet.flatten([
        styles.heading2,
        variant === "chat" && styles.heading2Chat,
        tone === "onAccent" && styles.headingOnAccent,
      ]),
      heading3: StyleSheet.flatten([
        styles.heading3,
        variant === "chat" && styles.heading3Chat,
        tone === "onAccent" && styles.headingOnAccent,
      ]),
      strong: StyleSheet.flatten([styles.strong, tone === "onAccent" && styles.strongOnAccent]),
      link: StyleSheet.flatten([styles.link, tone === "onAccent" && styles.linkOnAccent]),
      code_inline: StyleSheet.flatten([
        styles.code_inline,
        tone === "onAccent" && styles.codeInlineOnAccent,
      ]),
    }),
    [styles, tone, variant],
  );
  return (
    <Markdown mergeStyle={false} rules={rules} style={markdownStyles}>
      {children}
    </Markdown>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    body: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21 },
    bodyChat: { fontSize: 15, lineHeight: 22 },
    bodyOnAccent: { color: theme.colors.accentText },
    text: { color: theme.colors.textSecondary },
    textOnAccent: { color: theme.colors.accentText },
    paragraph: {
      width: "100%",
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "flex-start",
      marginTop: theme.space.none,
      marginBottom: theme.space.md,
    },
    paragraphChat: { marginBottom: theme.space.sm },
    paragraphInList: { marginBottom: theme.space.none },
    heading1: {
      color: theme.colors.text,
      fontSize: 22,
      lineHeight: 28,
      fontWeight: "800",
      marginTop: theme.space.xl,
      marginBottom: theme.space.md,
      flexDirection: "row",
      flexWrap: "wrap",
    },
    heading2: {
      color: theme.colors.text,
      fontSize: 18,
      lineHeight: 24,
      fontWeight: "800",
      marginTop: theme.space.xl,
      marginBottom: theme.space.sm,
      flexDirection: "row",
      flexWrap: "wrap",
    },
    heading3: {
      color: theme.colors.text,
      fontSize: 15,
      lineHeight: 21,
      fontWeight: "800",
      marginTop: theme.space.lg,
      marginBottom: theme.space.sm,
      flexDirection: "row",
      flexWrap: "wrap",
    },
    heading1Chat: { fontSize: 18, lineHeight: 23, marginTop: theme.space.sm },
    heading2Chat: { fontSize: 16, lineHeight: 21, marginTop: theme.space.sm },
    heading3Chat: { fontSize: 15, lineHeight: 20, marginTop: theme.space.sm },
    headingOnAccent: { color: theme.colors.accentText },
    strong: { fontWeight: "800", color: theme.colors.text },
    strongOnAccent: { color: theme.colors.accentText },
    em: { fontStyle: "italic" },
    s: { textDecorationLine: "line-through" },
    link: { color: theme.colors.info, textDecorationLine: "underline" },
    linkOnAccent: { color: theme.colors.accentText },
    bullet_list: { marginBottom: theme.space.md },
    ordered_list: { marginBottom: theme.space.md },
    list_item: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginBottom: theme.space.xxs,
    },
    bullet_list_icon: {
      color: theme.colors.accent,
      marginLeft: theme.space.none,
      marginRight: theme.space.sm,
    },
    bullet_list_content: { flex: 1 },
    ordered_list_icon: {
      color: theme.colors.accent,
      marginLeft: theme.space.none,
      marginRight: theme.space.sm,
    },
    ordered_list_content: { flex: 1 },
    blockquote: {
      backgroundColor: theme.colors.surface,
      borderLeftColor: theme.colors.accent,
      borderLeftWidth: 2,
      paddingLeft: theme.space.md,
      paddingVertical: theme.space.sm,
      marginVertical: theme.space.md,
    },
    code_inline: {
      color: theme.colors.text,
      backgroundColor: theme.colors.surfaceRaised,
      borderColor: theme.colors.separatorStrong,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: theme.radius.sm,
      paddingHorizontal: theme.space.xs,
      paddingVertical: theme.space.none,
      fontFamily: "monospace",
      fontSize: 12,
    },
    codeInlineOnAccent: {
      color: theme.colors.accentText,
      backgroundColor: theme.colors.accent,
    },
    codeBlock: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.separator,
      borderWidth: StyleSheet.hairlineWidth,
      padding: theme.space.md,
      marginVertical: theme.space.md,
    },
    codeText: {
      color: theme.colors.textSecondary,
      fontFamily: "monospace",
      fontSize: 12,
      lineHeight: 18,
    },
    fence: {},
    code_block: {},
    table: {
      borderColor: theme.colors.separator,
      borderWidth: StyleSheet.hairlineWidth,
      marginVertical: theme.space.md,
    },
    tr: { borderBottomColor: theme.colors.separator, borderBottomWidth: StyleSheet.hairlineWidth },
    th: { padding: theme.space.sm, fontWeight: "800" },
    td: { padding: theme.space.sm },
    hr: { backgroundColor: theme.colors.separator, height: StyleSheet.hairlineWidth },
    textgroup: {},
    hardbreak: { width: "100%", height: StyleSheet.hairlineWidth },
    softbreak: {},
    image: { maxWidth: "100%" },
  });
