import * as SecureStore from "expo-secure-store";
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

function channelIcon(channel: string): string {
  return (
    { dashboard: "V", discord: "D", telegram: "T", voice: "◉", direct: "A", api: "A" }[channel] ??
    "V"
  );
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

export function ChatScreen({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { width } = useWindowDimensions();
  const desktop = width >= 760;
  const [sessionId, setSessionId] = useState<string | null>(desktop ? DEFAULT_SESSION : null);
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
    if (desktop && !sessionId) setSessionId(DEFAULT_SESSION);
  }, [desktop, sessionId]);

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
              setSessionId(null);
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
        <SessionList sessions={sessions} selectedId={sessionId} onSelect={setSessionId} />
        <View style={styles.desktopConversation}>{conversation}</View>
      </View>
    );
  }

  return (
    conversation ?? <SessionList sessions={sessions} selectedId={null} onSelect={setSessionId} />
  );
}

function SessionList({
  sessions,
  selectedId,
  onSelect,
}: {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.listRoot}>
      <ScrollView contentContainerStyle={styles.sessionList}>
        {sessions.map((session) => (
          <Pressable
            key={session.id}
            onPress={() => onSelect(session.id)}
            style={[styles.sessionRow, selectedId === session.id && styles.sessionRowActive]}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{channelIcon(session.channel)}</Text>
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
        {!sessions.length && <ActivityIndicator color="#aee95a" style={styles.listLoader} />}
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
  return (
    <KeyboardAvoidingView
      style={styles.conversationRoot}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={8}
    >
      <View style={styles.conversationHeader}>
        <Pressable onPress={onBack} disabled={!onBack} style={styles.headerButton}>
          <Text style={[styles.backText, !onBack && styles.hidden]}>‹</Text>
        </Pressable>
        <View style={styles.conversationIdentity}>
          <View style={styles.miniAvatar}>
            <Text style={styles.miniAvatarText}>{channelIcon(session.channel)}</Text>
          </View>
          <Text style={styles.conversationTitle} numberOfLines={1}>
            {sessionName(session)}
          </Text>
          <Text style={styles.conversationChannel}>{session.channel}</Text>
        </View>
        <Pressable onPress={onMenu} style={styles.headerButton}>
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
          <ActivityIndicator color="#aee95a" style={styles.loader} />
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
          placeholderTextColor="#6f756f"
          multiline
          maxLength={12000}
          style={styles.input}
        />
        <Pressable
          disabled={!input.trim() || sending}
          onPress={onSend}
          style={[styles.send, (!input.trim() || sending) && styles.sendDisabled]}
        >
          {sending ? <ActivityIndicator color="#10140d" /> : <Text style={styles.sendText}>↑</Text>}
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
        <Text style={styles.thoughtText}>{cleanContent(message.content)}</Text>
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
        <Text style={[styles.messageText, user && styles.userMessageText]}>
          {cleanContent(message.content)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  desktopRoot: { flex: 1, flexDirection: "row", backgroundColor: "#090b09" },
  desktopConversation: { flex: 1, borderLeftWidth: 1, borderLeftColor: "#252925" },
  listRoot: { flex: 1, backgroundColor: "#0a0c0a" },
  sessionList: { paddingLeft: 14, paddingTop: 6 },
  listLoader: { marginTop: 80 },
  sessionRow: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingRight: 12,
  },
  sessionRowActive: { backgroundColor: "#171c15" },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#283321",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#c5f582", fontWeight: "800", fontSize: 17 },
  sessionBody: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#242724",
  },
  sessionTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  sessionName: { flex: 1, color: "#eef0ed", fontSize: 15, fontWeight: "700" },
  sessionTime: { color: "#707770", fontSize: 11 },
  chevron: { color: "#666d66", fontSize: 20 },
  sessionPreview: { color: "#737a73", fontSize: 12, marginTop: 5 },
  conversationRoot: { flex: 1, minHeight: 0, backgroundColor: "#090b09", overflow: "hidden" },
  conversationHeader: {
    height: 62,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#252925",
    backgroundColor: "#0d0f0d",
  },
  headerButton: { width: 58, height: 58, alignItems: "center", justifyContent: "center" },
  backText: { color: "#b6ef59", fontSize: 40, lineHeight: 42, fontWeight: "300" },
  hidden: { opacity: 0 },
  moreText: { color: "#b6ef59", fontSize: 17, letterSpacing: 1.5 },
  conversationIdentity: { flex: 1, alignItems: "center" },
  miniAvatar: {
    width: 27,
    height: 27,
    borderRadius: 14,
    backgroundColor: "#293522",
    alignItems: "center",
    justifyContent: "center",
  },
  miniAvatarText: { color: "#c6f580", fontSize: 10, fontWeight: "900" },
  conversationTitle: {
    color: "#f1f3ef",
    fontSize: 13,
    fontWeight: "700",
    maxWidth: "92%",
    marginTop: 2,
  },
  conversationChannel: { color: "#707770", fontSize: 9, textTransform: "capitalize" },
  menu: {
    position: "absolute",
    zIndex: 20,
    top: 54,
    right: 10,
    width: 218,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "#202320",
    borderWidth: 1,
    borderColor: "#3a3f3a",
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
  menuLabel: { color: "#f0f2ef", fontSize: 14, fontWeight: "600" },
  menuRule: { height: 1, backgroundColor: "#363a36" },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 14,
    backgroundColor: "#484e48",
    padding: 2,
  },
  toggleTrackOn: { backgroundColor: "#79b638" },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#f4f5f2",
  },
  toggleThumbOn: { alignSelf: "flex-end" },
  messages: { flex: 1, minHeight: 0 },
  messageContent: {
    paddingHorizontal: 12,
    paddingVertical: 18,
    gap: 7,
    flexGrow: 1,
    justifyContent: "flex-end",
  },
  loader: { marginVertical: 80 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: "#cfd3ce", fontWeight: "700", fontSize: 16 },
  emptyText: { color: "#6f766f", fontSize: 12, marginTop: 5 },
  messageRow: { flexDirection: "row" },
  userRow: { justifyContent: "flex-end" },
  bubble: { maxWidth: "82%", borderRadius: 19, paddingHorizontal: 13, paddingVertical: 9 },
  assistantBubble: { backgroundColor: "#242724", borderBottomLeftRadius: 5 },
  userBubble: { backgroundColor: "#adeb58", borderBottomRightRadius: 5 },
  messageText: { color: "#f0f2ef", fontSize: 15, lineHeight: 20 },
  userMessageText: { color: "#10140c" },
  thoughtCard: {
    maxWidth: "88%",
    alignSelf: "flex-start",
    borderRadius: 13,
    padding: 11,
    backgroundColor: "#121512",
    borderWidth: 1,
    borderColor: "#3b4433",
  },
  toolCard: {
    maxWidth: "92%",
    alignSelf: "flex-start",
    borderRadius: 13,
    padding: 11,
    backgroundColor: "#10171b",
    borderWidth: 1,
    borderColor: "#294656",
  },
  toolResponseCard: { backgroundColor: "#101816", borderColor: "#285046" },
  specialHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  thoughtLabel: { color: "#b8e777", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  toolLabel: { color: "#76c7ed", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  toolResponseLabel: { color: "#69d8bd" },
  specialTime: {
    flexShrink: 1,
    color: "#777f77",
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  thoughtText: {
    color: "#aeb5ae",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 7,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  toolText: {
    color: "#a7b8bf",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 7,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  error: { color: "#ef827b", fontSize: 11, paddingHorizontal: 12, paddingVertical: 5 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 7,
    marginHorizontal: 10,
    marginVertical: 8,
    minHeight: 44,
    paddingLeft: 14,
    paddingRight: 5,
    paddingVertical: 4,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: "#353a35",
    backgroundColor: "#171a17",
  },
  input: {
    flex: 1,
    maxHeight: 112,
    minHeight: 34,
    color: "#f0f2ef",
    fontSize: 15,
    paddingTop: 7,
    paddingBottom: 6,
  },
  send: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: "#adeb58",
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.32 },
  sendText: { color: "#11150d", fontSize: 21, fontWeight: "900", lineHeight: 23 },
});
