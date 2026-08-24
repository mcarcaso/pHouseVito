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
import { driveFileSource } from "../../services/api/client";
import { MarkdownText } from "../../components/markdown/MarkdownText";
import { DESKTOP_BREAKPOINT, useThemeStyles, useVitoTheme } from "../../hooks/useVitoTheme";
import { createChatStyles } from "./styles";

type MessageAttachment = {
  type: string;
  path: string;
  filename?: string;
  mimeType?: string;
};
type MessageBody = { text: string; attachments: MessageAttachment[] };

function unpackContent(content: string): MessageBody {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed === "string") return { text: parsed, attachments: [] };
    if (parsed && typeof parsed === "object") {
      const envelope = parsed as { text?: unknown; attachments?: unknown };
      if (typeof envelope.text === "string") {
        const attachments = Array.isArray(envelope.attachments)
          ? envelope.attachments.filter((item): item is MessageAttachment =>
              Boolean(
                item &&
                typeof item === "object" &&
                typeof (item as MessageAttachment).type === "string" &&
                typeof (item as MessageAttachment).path === "string",
              ),
            )
          : [];
        return { text: envelope.text, attachments };
      }
    }
    return { text: JSON.stringify(parsed, null, 2), attachments: [] };
  } catch {
    return { text: content, attachments: [] };
  }
}

function cleanContent(content: string): string {
  return unpackContent(content).text;
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
  const styles = useThemeStyles(createChatStyles);
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
  const styles = useThemeStyles(createChatStyles);
  if (!attachments.length) return null;
  return (
    <View style={styles.attachments}>
      {attachments.map((attachment, index) => {
        const source = driveFileSource(attachment.path);
        const key = `${attachment.path}:${index}`;
        if (attachment.type === "image" && source)
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
  const styles = useThemeStyles(createChatStyles);
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
  const styles = useThemeStyles(createChatStyles);
  const tool = compactToolContent(message.content);
  const response = message.type === "tool_end";
  const [raw, setRaw] = useState(false);
  return (
    <View style={[styles.toolCard, response && styles.toolResponseCard]}>
      <View style={styles.specialHeader}>
        <Text style={[styles.toolLabel, response && styles.toolResponseLabel]}>
          {response ? "TOOL RESPONSE" : "TOOL CALL"}
        </Text>
        <Text style={styles.specialTime}>{tool.title}</Text>
        <Pressable onPress={() => setRaw((value) => !value)} hitSlop={8}>
          <Text style={styles.toolMode}>{raw ? "PRETTY" : "RAW"}</Text>
        </Pressable>
      </View>
      <View style={styles.toolBody}>
        {raw ? (
          <Text selectable style={styles.toolRaw}>
            {prettyRawJson(message.content)}
          </Text>
        ) : (
          <ToolValue value={tool.detail} />
        )}
      </View>
    </View>
  );
}

export function MessageRow({ message }: { message: Message }) {
  const styles = useThemeStyles(createChatStyles);
  const { width } = useWindowDimensions();
  const desktop = width >= DESKTOP_BREAKPOINT;
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
  const body = unpackContent(message.content);
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
      </View>
    </View>
  );
}
