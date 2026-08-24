import * as SecureStore from "expo-secure-store";
import { FontAwesome6, Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  ApiError,
  useSendChatMessage,
  useSessionMessages,
  useSessions,
  type VitoMessage as Message,
  type VitoSession as Session,
} from "@vito/client";
import { MarkdownText } from "./MarkdownText";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "./theme";

const DEFAULT_SESSION = "dashboard:default";
const FILTER_KEY = "vito-chat-display-filters";

type Filters = { thoughts: boolean; tools: boolean };

function cleanContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed === "string") return parsed;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return content;
  }
}

function compactToolContent(content: string): { title: string; detail: string } {
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    const success = value.tool_success as Record<string, unknown> | undefined;
    const failure = value.tool_error as Record<string, unknown> | undefined;
    const name = String(success?.name ?? failure?.name ?? value.name ?? value.toolName ?? "Tool");
    const payload =
      success?.arguments ?? failure?.error ?? value.arguments ?? value.result ?? value;
    return {
      title: name.replaceAll("_", " "),
      detail: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
    };
  } catch {
    return { title: "Tool activity", detail: content };
  }
}

function sessionName(session: Session): string {
  return session.alias?.trim() || session.id;
}

function ChannelIcon({ channel, compact = false }: { channel: string; compact?: boolean }) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const size = compact ? 12 : 19;
  if (channel === "discord" || channel === "telegram")
    return (
      <FontAwesome6
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        name={channel}
        size={size}
        color={theme.colors.accent}
      />
    );
  if (channel === "voice") return <Ionicons name="mic" size={size} color={theme.colors.accent} />;
  if (channel === "direct" || channel === "api")
    return <Ionicons name="terminal-outline" size={size} color={theme.colors.accent} />;
  return <Text style={compact ? styles.miniAvatarText : styles.avatarText}>V</Text>;
}

function relativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "Now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  if (delta < 604_800_000) return `${Math.floor(delta / 86_400_000)}d`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function loadFilters(): Promise<Filters> {
  try {
    const raw =
      Platform.OS === "web"
        ? globalThis.localStorage?.getItem(FILTER_KEY)
        : await SecureStore.getItemAsync(FILTER_KEY);
    return raw ? (JSON.parse(raw) as Filters) : { thoughts: true, tools: true };
  } catch {
    return { thoughts: true, tools: true };
  }
}

async function saveFilters(filters: Filters): Promise<void> {
  const value = JSON.stringify(filters);
  if (Platform.OS === "web") globalThis.localStorage?.setItem(FILTER_KEY, value);
  else await SecureStore.setItemAsync(FILTER_KEY, value);
}

export function ChatScreen({
  onUnauthorized,
  selectedSessionId,
  onSelectSession,
  onBack,
}: {
  onUnauthorized: () => void;
  selectedSessionId?: string | null;
  onSelectSession?: (session: Session) => void;
  onBack?: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const { width } = useWindowDimensions();
  const desktop = width >= 760;
  const [localSessionId, setLocalSessionId] = useState<string | null>(
    desktop ? DEFAULT_SESSION : null,
  );
  const controlled = selectedSessionId !== undefined;
  const sessionId = controlled ? selectedSessionId : localSessionId;
  const selectSession = (session: Session) => {
    if (onSelectSession) onSelectSession(session);
    else setLocalSessionId(session.id);
  };
  const [filters, setFilters] = useState<Filters>({ thoughts: true, tools: true });
  const [filtersReady, setFiltersReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [input, setInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const handleError = useCallback(
    (cause: unknown) => {
      if (cause instanceof ApiError && cause.status === 401) onUnauthorized();
      else setLocalError(cause instanceof Error ? cause.message : "Request failed");
    },
    [onUnauthorized],
  );

  useEffect(() => {
    void loadFilters().then((value) => {
      setFilters(value);
      setFiltersReady(true);
    });
  }, []);

  useEffect(() => {
    if (filtersReady) void saveFilters(filters);
  }, [filters, filtersReady]);

  useEffect(() => {
    if (desktop && !sessionId && !controlled) setLocalSessionId(DEFAULT_SESSION);
  }, [controlled, desktop, sessionId]);

  const sessionsQuery = useSessions({ refetchInterval: 5_000 });
  const sessions = sessionsQuery.data ?? [];
  const messagesQuery = useSessionMessages(filtersReady ? sessionId : null, {
    limit: 100,
    hideThoughts: !filters.thoughts,
    hideTools: !filters.tools,
    refetchInterval: 3_000,
  });
  const messages = messagesQuery.data?.messages ?? [];
  const sendMessage = useSendChatMessage();
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === sessionId),
    [sessionId, sessions],
  );

  useEffect(() => {
    const cause = sessionsQuery.error ?? messagesQuery.error;
    if (cause) handleError(cause);
  }, [handleError, messagesQuery.error, sessionsQuery.error]);

  const send = async () => {
    const content = input.trim();
    if (!content || sendMessage.isPending || !sessionId) return;
    setInput("");
    setLocalError(null);
    try {
      await sendMessage.mutateAsync({ sessionId, content });
      await messagesQuery.refetch();
    } catch (cause) {
      setInput(content);
      setLocalError(cause instanceof Error ? cause.message : "Request failed");
      handleError(cause);
    }
  };

  const conversation = sessionId ? (
    <Conversation
      session={selectedSession ?? { id: sessionId, channel: "dashboard", last_active_at: 0 }}
      messages={messages}
      loading={messagesQuery.isLoading}
      filters={filters}
      menuOpen={menuOpen}
      input={input}
      sending={sendMessage.isPending}
      error={localError}
      scrollRef={scrollRef}
      onBack={
        desktop
          ? undefined
          : () => {
              if (onBack) onBack();
              else setLocalSessionId(null);
              setMenuOpen(false);
            }
      }
      onMenu={() => setMenuOpen((open) => !open)}
      onFilters={setFilters}
      onInput={setInput}
      onSend={() => void send()}
    />
  ) : null;

  if (desktop) {
    return (
      <View style={styles.desktopRoot}>
        <View style={styles.desktopList}>
          <SessionList sessions={sessions} selectedId={sessionId} onSelect={selectSession} />
        </View>
        <View style={styles.desktopConversation}>{conversation}</View>
      </View>
    );
  }

  return (
    conversation ?? <SessionList sessions={sessions} selectedId={null} onSelect={selectSession} />
  );
}

function SessionList({
  sessions,
  selectedId,
  onSelect,
}: {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (session: Session) => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  return (
    <View style={styles.listRoot}>
      <ScrollView contentContainerStyle={styles.sessionList}>
        {sessions.map((session) => (
          <Pressable
            key={session.id}
            onPress={() => onSelect(session)}
            style={[styles.sessionRow, selectedId === session.id && styles.sessionRowActive]}
          >
            <View style={styles.avatar}>
              <ChannelIcon channel={session.channel} />
            </View>
            <View style={styles.sessionBody}>
              <View style={styles.sessionTop}>
                <Text style={styles.sessionName} numberOfLines={1}>
                  {sessionName(session)}
                </Text>
                <Text style={styles.sessionTime}>{relativeTime(session.last_active_at)}</Text>
                <Text style={styles.chevron}>›</Text>
              </View>
              <Text style={styles.sessionPreview} numberOfLines={1}>
                {session.channel} · {session.id}
              </Text>
            </View>
          </Pressable>
        ))}
        {!sessions.length && (
          <ActivityIndicator color={theme.colors.accent} style={styles.listLoader} />
        )}
      </ScrollView>
    </View>
  );
}

function Conversation({
  session,
  messages,
  loading,
  filters,
  menuOpen,
  input,
  sending,
  error,
  scrollRef,
  onBack,
  onMenu,
  onFilters,
  onInput,
  onSend,
}: {
  session: Session;
  messages: Message[];
  loading: boolean;
  filters: Filters;
  menuOpen: boolean;
  input: string;
  sending: boolean;
  error: string | null;
  scrollRef: React.RefObject<ScrollView | null>;
  onBack?: () => void;
  onMenu: () => void;
  onFilters: (filters: Filters) => void;
  onInput: (value: string) => void;
  onSend: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  return (
    <KeyboardAvoidingView
      style={styles.conversationRoot}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={8}
    >
      <View style={styles.conversationHeader}>
        <Pressable
          accessibilityLabel="Back to conversations"
          onPress={onBack}
          disabled={!onBack}
          style={styles.headerButton}
        >
          <Text style={[styles.backText, !onBack && styles.hidden]}>‹</Text>
        </Pressable>
        <View style={styles.conversationIdentity}>
          <View style={styles.miniAvatar}>
            <ChannelIcon channel={session.channel} compact />
          </View>
          <Text style={styles.conversationTitle} numberOfLines={1}>
            {sessionName(session)}
          </Text>
          <Text style={styles.conversationChannel}>{session.channel}</Text>
        </View>
        <Pressable
          accessibilityLabel="Conversation options"
          onPress={onMenu}
          style={styles.headerButton}
        >
          <Text style={styles.moreText}>•••</Text>
        </Pressable>
      </View>
      {menuOpen && (
        <View style={styles.menu}>
          <MenuToggle
            label="Show thoughts"
            value={filters.thoughts}
            onValue={(thoughts) => onFilters({ ...filters, thoughts })}
          />
          <View style={styles.menuRule} />
          <MenuToggle
            label="Show tools"
            value={filters.tools}
            onValue={(tools) => onFilters({ ...filters, tools })}
          />
        </View>
      )}
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messageContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {loading ? (
          <ActivityIndicator color={theme.colors.accent} style={styles.loader} />
        ) : messages.length ? (
          messages.map((message) => <MessageRow key={message.id} message={message} />)
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptyText}>Start this conversation with Vito.</Text>
          </View>
        )}
      </ScrollView>
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.composer}>
        <TextInput
          value={input}
          onChangeText={onInput}
          placeholder="Message Vito"
          placeholderTextColor={theme.colors.textMuted}
          multiline
          maxLength={12000}
          style={styles.input}
        />
        <Pressable
          disabled={!input.trim() || sending}
          onPress={onSend}
          style={[styles.send, (!input.trim() || sending) && styles.sendDisabled]}
        >
          {sending ? (
            <ActivityIndicator color={theme.colors.accentText} />
          ) : (
            <Text style={styles.sendText}>↑</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function MenuToggle({
  label,
  value,
  onValue,
}: {
  label: string;
  value: boolean;
  onValue: (value: boolean) => void;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <Pressable onPress={() => onValue(!value)} style={styles.menuRow}>
      <Text style={styles.menuLabel}>{label}</Text>
      <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
        <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
      </View>
    </Pressable>
  );
}

function MessageRow({ message }: { message: Message }) {
  const styles = useThemeStyles(createStyles);
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
        <MarkdownText variant="chat">{cleanContent(message.content)}</MarkdownText>
      </View>
    );
  if (message.type === "tool_start" || message.type === "tool_end") {
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
        <Text style={styles.toolText} numberOfLines={8}>
          {tool.detail}
        </Text>
      </View>
    );
  }
  const user = message.type === "user";
  return (
    <View style={[styles.messageRow, user && styles.userRow]}>
      <View style={[styles.bubble, user ? styles.userBubble : styles.assistantBubble]}>
        <MarkdownText variant="chat" tone={user ? "onAccent" : "default"}>
          {cleanContent(message.content)}
        </MarkdownText>
      </View>
    </View>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    desktopRoot: { flex: 1, flexDirection: "row", backgroundColor: theme.colors.canvas },
    desktopList: { width: 340, flexShrink: 0 },
    desktopConversation: {
      flex: 1,
      minWidth: 0,
      borderLeftWidth: 1,
      borderLeftColor: theme.colors.separator,
    },
    listRoot: { flex: 1, backgroundColor: theme.colors.canvas },
    sessionList: { paddingLeft: theme.space.lg, paddingTop: theme.space.sm },
    listLoader: { marginTop: theme.space.giant },
    sessionRow: {
      minHeight: 76,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      paddingRight: theme.space.md,
    },
    sessionRowActive: { backgroundColor: theme.colors.accentSurface },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: theme.colors.accentSurface,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { color: theme.colors.accent, fontWeight: "800", fontSize: 17 },
    sessionBody: {
      flex: 1,
      minWidth: 0,
      alignSelf: "stretch",
      justifyContent: "center",
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    sessionTop: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
    sessionName: { flex: 1, color: theme.colors.text, fontSize: 15, fontWeight: "700" },
    sessionTime: { color: theme.colors.textMuted, fontSize: 11 },
    chevron: { color: theme.colors.textMuted, fontSize: 20 },
    sessionPreview: { color: theme.colors.textMuted, fontSize: 12, marginTop: theme.space.xs },
    conversationRoot: {
      flex: 1,
      minHeight: 0,
      backgroundColor: theme.colors.canvas,
      overflow: "hidden",
    },
    conversationHeader: {
      height: 62,
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
      backgroundColor: theme.colors.sidebar,
    },
    headerButton: { width: 58, height: 58, alignItems: "center", justifyContent: "center" },
    backText: { color: theme.colors.accent, fontSize: 40, lineHeight: 42, fontWeight: "300" },
    hidden: { opacity: 0 },
    moreText: { color: theme.colors.accent, fontSize: 17, letterSpacing: 1.5 },
    conversationIdentity: { flex: 1, alignItems: "center" },
    miniAvatar: {
      width: 27,
      height: 27,
      borderRadius: 14,
      backgroundColor: theme.colors.accentSurface,
      alignItems: "center",
      justifyContent: "center",
    },
    miniAvatarText: { color: theme.colors.accent, fontSize: 10, fontWeight: "900" },
    conversationTitle: {
      color: theme.colors.text,
      fontSize: 13,
      fontWeight: "700",
      maxWidth: "92%",
      marginTop: theme.space.xxs,
    },
    conversationChannel: {
      color: theme.colors.textMuted,
      fontSize: 9,
      textTransform: "capitalize",
    },
    menu: {
      position: "absolute",
      zIndex: 20,
      top: 54,
      right: 10,
      width: 218,
      paddingHorizontal: theme.space.lg,
      borderRadius: 14,
      backgroundColor: theme.colors.surfaceRaised,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      shadowColor: "#000",
      shadowOpacity: 0.45,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
    },
    menuRow: {
      minHeight: 53,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    menuLabel: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
    menuRule: { height: 1, backgroundColor: theme.colors.separatorStrong },
    toggleTrack: {
      width: 44,
      height: 26,
      borderRadius: 14,
      backgroundColor: theme.colors.surfaceRaised,
      padding: theme.space.xxs,
    },
    toggleTrackOn: { backgroundColor: theme.colors.accent },
    toggleThumb: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: theme.colors.text,
    },
    toggleThumbOn: { alignSelf: "flex-end" },
    messages: { flex: 1, minHeight: 0 },
    messageContent: {
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.xl,
      gap: theme.space.sm,
      flexGrow: 1,
      justifyContent: "flex-end",
    },
    loader: { marginVertical: theme.space.giant },
    empty: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyTitle: { color: theme.colors.textSecondary, fontWeight: "700", fontSize: 16 },
    emptyText: { color: theme.colors.textMuted, fontSize: 12, marginTop: theme.space.xs },
    messageRow: { flexDirection: "row" },
    userRow: { justifyContent: "flex-end" },
    bubble: {
      maxWidth: "82%",
      borderRadius: 19,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.sm,
    },
    assistantBubble: { backgroundColor: theme.colors.separator, borderBottomLeftRadius: 5 },
    userBubble: { backgroundColor: theme.colors.accent, borderBottomRightRadius: 5 },
    thoughtCard: {
      maxWidth: "88%",
      alignSelf: "flex-start",
      borderRadius: 13,
      padding: theme.space.md,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
    },
    toolCard: {
      maxWidth: "92%",
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
    thoughtLabel: { color: theme.colors.accent, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
    toolLabel: { color: theme.colors.info, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
    toolResponseLabel: { color: theme.colors.success },
    specialTime: {
      flexShrink: 1,
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "700",
      textTransform: "uppercase",
    },
    toolText: {
      color: theme.colors.textSecondary,
      fontSize: 11,
      lineHeight: 16,
      marginTop: theme.space.sm,
      fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    },
    error: {
      color: theme.colors.danger,
      fontSize: 11,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.xs,
    },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: theme.space.sm,
      marginHorizontal: theme.space.md,
      marginVertical: theme.space.sm,
      minHeight: 44,
      paddingLeft: theme.space.lg,
      paddingRight: theme.space.xs,
      paddingVertical: theme.space.xs,
      borderRadius: 23,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      backgroundColor: theme.colors.surface,
    },
    input: {
      flex: 1,
      maxHeight: 112,
      minHeight: 34,
      color: theme.colors.text,
      fontSize: 15,
      paddingTop: theme.space.sm,
      paddingBottom: theme.space.sm,
    },
    send: {
      width: 35,
      height: 35,
      borderRadius: 18,
      backgroundColor: theme.colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    sendDisabled: { opacity: 0.32 },
    sendText: { color: theme.colors.accentText, fontSize: 21, fontWeight: "900", lineHeight: 23 },
  });
