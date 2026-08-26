import type { VitoTheme } from "../../hooks/useVitoTheme";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

type ImageSource = { uri: string; headers?: { Authorization: string } };

async function imageBase64(source: ImageSource): Promise<string> {
  if (Platform.OS === "web") {
    const response = await fetch(source.uri, { headers: source.headers });
    if (!response.ok) throw new Error(`Image request failed (${response.status})`);
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("Couldn’t read image"));
      reader.readAsDataURL(blob);
    });
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
  }

  if (!FileSystem.cacheDirectory) throw new Error("No cache directory is available");
  const destination = `${FileSystem.cacheDirectory}vito-image-${Date.now()}`;
  const downloaded = await FileSystem.downloadAsync(source.uri, destination, {
    headers: source.headers,
  });
  try {
    return await FileSystem.readAsStringAsync(downloaded.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } finally {
    await FileSystem.deleteAsync(downloaded.uri, { idempotent: true }).catch(() => undefined);
  }
}

function FullscreenImage({
  source,
  displaySource,
  label,
  visible,
  onClose,
}: {
  source: ImageSource;
  displaySource: ImageSource;
  label: string;
  visible: boolean;
  onClose: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const insets = useSafeAreaInsets();
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!visible) setCopied(false);
  }, [visible]);

  const copy = async () => {
    if (copying) return;
    setCopying(true);
    setCopied(false);
    try {
      await Clipboard.setImageAsync(await imageBase64(source));
      setCopied(true);
    } catch {
      Alert.alert("Couldn’t copy image", "The image couldn’t be placed on the clipboard.");
    } finally {
      setCopying(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.imageViewer}>
        <View
          style={[styles.imageViewerToolbar, { paddingTop: Math.max(insets.top, theme.space.md) }]}
        >
          <Pressable accessibilityLabel="Close image" onPress={onClose} style={styles.viewerButton}>
            <Ionicons name="close" size={24} color={theme.colors.text} />
          </Pressable>
          <Pressable
            accessibilityLabel={copied ? "Image copied" : "Copy image"}
            disabled={copying}
            onPress={() => void copy()}
            style={styles.viewerButton}
          >
            {copying ? (
              <ActivityIndicator color={theme.colors.text} />
            ) : (
              <Ionicons
                name={copied ? "checkmark" : "copy-outline"}
                size={21}
                color={theme.colors.text}
              />
            )}
          </Pressable>
        </View>
        <Image
          accessibilityLabel={label}
          source={displaySource}
          resizeMode="contain"
          style={styles.fullscreenImage}
        />
      </View>
    </Modal>
  );
}

function MessageImage({ source, label }: { source: ImageSource; label: string }) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const [resolvedSource, setResolvedSource] = useState<ImageSource | undefined>(
    Platform.OS === "web" ? undefined : source,
  );
  const [failed, setFailed] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
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
    <>
      <Pressable accessibilityLabel={`View ${label}`} onPress={() => setViewerOpen(true)}>
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
      </Pressable>
      <FullscreenImage
        source={source}
        displaySource={resolvedSource}
        label={label}
        visible={viewerOpen}
        onClose={() => setViewerOpen(false)}
      />
    </>
  );
}

async function downloadWebAttachment(source: ImageSource, filename: string): Promise<void> {
  const response = await fetch(source.uri, { headers: source.headers });
  if (!response.ok) throw new Error(`Attachment request failed (${response.status})`);
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }
}

function MessageFile({
  source,
  filename,
  mimeType,
}: {
  source?: ImageSource;
  filename: string;
  mimeType?: string;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState(false);
  const canDownload = Platform.OS === "web" && Boolean(source);

  const download = async () => {
    if (!source || !canDownload || downloading) return;
    setDownloading(true);
    setFailed(false);
    try {
      await downloadWebAttachment(source, filename);
    } catch {
      setFailed(true);
    } finally {
      setDownloading(false);
    }
  };

  const contents = (
    <>
      <Ionicons name="document-outline" size={18} style={styles.attachmentFileIcon} />
      <View style={styles.attachmentFileBody}>
        <Text numberOfLines={1} style={styles.attachmentFileName}>
          {filename}
        </Text>
        <Text style={[styles.attachmentFileType, failed && styles.attachmentFileError]}>
          {failed ? "Download failed" : mimeType || "File"}
        </Text>
      </View>
      {canDownload &&
        (downloading ? (
          <ActivityIndicator color={theme.colors.accent} size="small" />
        ) : (
          <Ionicons name="download-outline" size={19} style={styles.attachmentFileAction} />
        ))}
    </>
  );

  if (!canDownload) return <View style={styles.attachmentFile}>{contents}</View>;
  return (
    <Pressable
      accessibilityLabel={`Download ${filename}`}
      accessibilityRole="link"
      onPress={() => void download()}
      style={({ pressed }) => [styles.attachmentFile, pressed && styles.attachmentFilePressed]}
    >
      {contents}
    </Pressable>
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
          <MessageFile
            key={key}
            source={source}
            filename={attachment.filename ?? "Attachment"}
            mimeType={attachment.mimeType}
          />
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
    imageViewer: { flex: 1, backgroundColor: theme.colors.canvas },
    imageViewerToolbar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.space.md,
      paddingBottom: theme.space.sm,
      backgroundColor: theme.colors.canvas,
    },
    viewerButton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.radius.round,
      backgroundColor: theme.colors.surfaceRaised,
    },
    fullscreenImage: { flex: 1, width: "100%" },
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
    attachmentFileError: { color: theme.colors.danger },
    attachmentFileAction: { color: theme.colors.textMuted },
    attachmentFilePressed: { opacity: 0.72 },
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
      maxWidth: "88%",
      borderRadius: 19,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.sm,
    },
    desktopBubble: { maxWidth: 680 },
    desktopAttachmentBubble: { width: 480 },
    userBubble: { backgroundColor: theme.colors.accent, borderBottomRightRadius: 5 },
    assistantBubble: {
      width: "100%",
      maxWidth: "100%",
      paddingHorizontal: theme.space.sm,
      backgroundColor: "transparent",
      borderBottomLeftRadius: 0,
    },
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
