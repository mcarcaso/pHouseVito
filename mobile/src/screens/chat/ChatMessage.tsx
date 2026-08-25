import type { VitoTheme } from "../../hooks/useVitoTheme";
import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { VitoMessage as Message } from "@vito/client";
import { attachmentFileSource } from "../../services/api/client";
import { MarkdownText } from "../../components/markdown/MarkdownText";
import { StructuredValue } from "../../components/StructuredValue";
import { DESKTOP_BREAKPOINT, useThemeStyles, useVitoTheme } from "../../hooks/useVitoTheme";
import { useSpeech } from "../../contexts/speech";
import { unpackMessageContent, type MessageAttachment } from "./message-content";

function cleanContent(content: string): string {
  return unpackMessageContent(content).text;
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function compactToolContent(content: string): { title: string; detail: unknown } {
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    const success = value.tool_success as Record<string, unknown> | undefined;
    const failure = value.tool_error as Record<string, unknown> | undefined;
    const name = String(success?.name ?? failure?.name ?? value.name ?? value.toolName ?? "Tool");
    const payload =
      success?.arguments ??
      failure?.error ??
      value.args ??
      value.arguments ??
      value.result ??
      value;
    return { title: name.replaceAll("_", " "), detail: parseJsonString(payload) };
  } catch {
    return { title: "Tool activity", detail: content };
  }
}

function MessageImage({
  source,
  label,
}: {
  source: { uri: string; headers?: { Authorization: string } };
  label: string;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const [resolvedSource, setResolvedSource] = useState<typeof source | undefined>(
    Platform.OS === "web" ? undefined : source,
  );
  const [failed, setFailed] = useState(false);
  const authorization = source.headers?.Authorization;
  useEffect(() => {
    if (Platform.OS !== "web") {
      setResolvedSource(source);
      return;
    }
    let active = true;
    let objectUrl: string | undefined;
    void fetch(source.uri, {
      headers: authorization ? { Authorization: authorization } : undefined,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Attachment request failed (${response.status})`);
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setResolvedSource({ uri: objectUrl });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [authorization, source.uri]);
  if (failed) return <Text style={styles.attachmentError}>Couldn’t load {label}</Text>;
  if (!resolvedSource)
    return <ActivityIndicator color={theme.colors.accent} style={styles.attachmentLoader} />;
  return (
    <Image
      accessibilityLabel={label}
      source={resolvedSource}
      resizeMode="contain"
      onLoad={(event) => {
        const dimensions = event.nativeEvent.source;
        if (dimensions?.width > 0 && dimensions.height > 0)
          setAspectRatio(dimensions.width / dimensions.height);
      }}
      style={[styles.attachmentImage, { aspectRatio }]}
    />
  );
}

function MessageAttachments({ attachments }: { attachments: MessageAttachment[] }) {
  const styles = useThemeStyles(createStyles);
  if (!attachments.length) return null;
  return (
    <View style={styles.attachments}>
      {attachments.map((attachment, index) => {
        const source = attachmentFileSource(attachment.path, attachment.url);
        const key = `${attachment.path}:${index}`;
        const image = attachment.type === "image" || attachment.mimeType?.startsWith("image/");
        if (image && source)
          return (
            <MessageImage
              key={key}
              label={attachment.filename ?? "Attached image"}
              source={source}
            />
          );
        return (
          <View key={key} style={styles.attachmentFile}>
            <Ionicons name="document-outline" size={18} style={styles.attachmentFileIcon} />
            <View style={styles.attachmentFileBody}>
              <Text numberOfLines={1} style={styles.attachmentFileName}>
                {attachment.filename ?? "Attachment"}
              </Text>
              {attachment.mimeType && (
                <Text style={styles.attachmentFileType}>{attachment.mimeType}</Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ToolValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const styles = useThemeStyles(createStyles);
  const parsed = parseJsonString(value);
  const collection = parsed !== null && typeof parsed === "object";
  const entries = collection ? Object.entries(parsed as Record<string, unknown>) : [];

  if (collection) {
    const array = Array.isArray(parsed);
    if (!entries.length) return <Text style={styles.toolPrimitive}>{array ? "[]" : "{}"}</Text>;
    return (
      <View style={depth > 0 ? styles.toolBranch : undefined}>
        {entries.map(([key, child]) => (
          <View key={key} style={styles.toolField}>
            <Text selectable style={styles.toolKey}>
              {array ? Number(key) + 1 : key}
            </Text>
            <ToolValue value={child} depth={depth + 1} />
          </View>
        ))}
      </View>
    );
  }

  if (typeof parsed === "string")
    return (
      <View style={styles.toolMarkdown}>
        <MarkdownText variant="chat">{parsed}</MarkdownText>
      </View>
    );

  return (
    <Text selectable style={styles.toolPrimitive}>
      {String(parsed)}
    </Text>
  );
}

function prettyRawJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content) as unknown, null, 2);
  } catch {
    return content;
  }
}

function ToolMessage({ message }: { message: Message }) {
  const styles = useThemeStyles(createStyles);
  const tool = compactToolContent(message.content);
  const response = message.type === "tool_end";
  return (
    <View style={[styles.toolCard, response && styles.toolResponseCard]}>
      <View style={styles.specialHeader}>
        <Text style={[styles.toolLabel, response && styles.toolResponseLabel]}>
          {response ? "TOOL RESPONSE" : "TOOL CALL"}
        </Text>
        <Text style={styles.specialTime}>{tool.title}</Text>
      </View>
      <View style={styles.toolBody}>
        <StructuredValue value={tool.detail} rawValue={prettyRawJson(message.content)} />
      </View>
    </View>
  );
}

function speechText(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " Code block omitted. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[>*_~]/g, "")
    .trim();
}

export function MessageRow({ message }: { message: Message }) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const speech = useSpeech();
  const desktop = false;
  if (message.type === "thought")
    return (
      <View style={styles.thoughtCard}>
        <View style={styles.specialHeader}>
          <Text style={styles.thoughtLabel}>THOUGHT</Text>
          <Text style={styles.specialTime}>
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </Text>
        </View>
        <View style={styles.thoughtBody}>
          <MarkdownText variant="chat">{cleanContent(message.content)}</MarkdownText>
        </View>
      </View>
    );
  if (message.type === "tool_start" || message.type === "tool_end")
    return <ToolMessage message={message} />;
  const user = message.type === "user";
  const body = unpackMessageContent(message.content);
  return (
    <View style={[styles.messageRow, user && styles.userRow]}>
      <View
        style={[
          styles.bubble,
          desktop && styles.desktopBubble,
          desktop && body.attachments.length > 0 && styles.desktopAttachmentBubble,
          user ? styles.userBubble : styles.assistantBubble,
        ]}
      >
        {body.text && (
          <MarkdownText variant="chat" tone={user ? "onAccent" : "default"}>
            {body.text}
          </MarkdownText>
        )}
        <MessageAttachments attachments={body.attachments} />
        {!user && !!body.text && (
          <Pressable
            accessibilityLabel={
              speech.state.id === String(message.id) && speech.state.status === "playing"
                ? "Pause reading"
                : "Read message aloud"
            }
            onPress={() => void speech.toggle(String(message.id), speechText(body.text))}
            style={styles.speechButton}
          >
            {speech.state.id === String(message.id) && speech.state.status === "loading" ? (
              <ActivityIndicator size="small" color={theme.colors.textMuted} />
            ) : (
              <Ionicons
                name={
                  speech.state.id === String(message.id) && speech.state.status === "playing"
                    ? "pause"
                    : speech.state.id === String(message.id) && speech.state.status === "paused"
                      ? "play"
                      : "volume-medium-outline"
                }
                size={16}
                color={theme.colors.textMuted}
              />
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    attachmentError: { color: theme.colors.danger, fontSize: 12 },
    attachmentLoader: { marginVertical: theme.space.xl },
    attachmentImage: {
      width: "100%",
      maxHeight: 420,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.canvas,
    },
    attachments: { gap: theme.space.sm, marginTop: theme.space.sm },
    attachmentFile: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      paddingVertical: theme.space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.separatorStrong,
    },
    attachmentFileIcon: { color: theme.colors.accent },
    attachmentFileBody: { flex: 1, minWidth: 0 },
    attachmentFileName: { color: theme.colors.text, fontSize: 13, fontWeight: "700" },
    attachmentFileType: { color: theme.colors.textMuted, fontSize: 11, marginTop: theme.space.xxs },
    toolPrimitive: {
      color: theme.colors.textSecondary,
      fontSize: 11,
      lineHeight: 16,
      fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    },
    toolBranch: {
      marginTop: theme.space.xs,
      marginLeft: theme.space.sm,
      paddingLeft: theme.space.sm,
      borderLeftWidth: 1,
      borderLeftColor: theme.colors.separatorStrong,
    },
    toolField: { marginTop: theme.space.sm },
    toolKey: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: "800",
      marginBottom: theme.space.xxs,
      fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    },
    toolMarkdown: { width: "100%", maxWidth: "100%", minWidth: 0, overflow: "hidden" },
    toolCard: {
      width: "92%",
      maxWidth: "92%",
      minWidth: 0,
      overflow: "hidden",
      alignSelf: "flex-start",
      borderRadius: 13,
      padding: theme.space.md,
      backgroundColor: theme.colors.infoSurface,
      borderWidth: 1,
      borderColor: theme.colors.info,
    },
    toolResponseCard: {
      backgroundColor: theme.colors.successSurface,
      borderColor: theme.colors.success,
    },
    specialHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.space.md,
    },
    toolLabel: { color: theme.colors.info, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
    toolResponseLabel: { color: theme.colors.success },
    specialTime: {
      flexShrink: 1,
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "700",
      textTransform: "uppercase",
    },
    toolMode: {
      color: theme.colors.accent,
      fontSize: 9,
      fontWeight: "900",
      letterSpacing: 0.8,
    },
    toolBody: { marginTop: theme.space.sm },
    toolRaw: {
      color: theme.colors.textSecondary,
      fontSize: 11,
      lineHeight: 16,
      fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    },
    thoughtCard: {
      maxWidth: "88%",
      alignSelf: "flex-start",
      borderRadius: 13,
      padding: theme.space.md,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
    },
    thoughtLabel: { color: theme.colors.accent, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
    thoughtBody: { marginTop: theme.space.sm },
    messageRow: { flexDirection: "row" },
    userRow: { justifyContent: "flex-end" },
    bubble: {
      maxWidth: "82%",
      borderRadius: 19,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.sm,
    },
    desktopBubble: { maxWidth: 680 },
    desktopAttachmentBubble: { width: 480 },
    userBubble: { backgroundColor: theme.colors.accent, borderBottomRightRadius: 5 },
    assistantBubble: { backgroundColor: theme.colors.separator, borderBottomLeftRadius: 5 },
    speechButton: {
      alignSelf: "flex-end",
      width: 30,
      height: 30,
      marginTop: theme.space.xxs,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.radius.round,
      backgroundColor: theme.colors.surfaceRaised,
    },
  });
