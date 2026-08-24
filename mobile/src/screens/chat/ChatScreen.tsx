import * as SecureStore from "expo-secure-store";
import { FontAwesome6, Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  ApiError,
  useLoadSessionMessages,
  useSendChatMessage,
  useSessionMessages,
  useSessions,
  type VitoMessage as Message,
  type VitoSession as Session,
} from "@vito/client";
import {
  DESKTOP_BREAKPOINT,
  useThemeStyles,
  useVitoTheme,
  type VitoTheme,
} from "../../hooks/useVitoTheme";
import { createChatStyles } from "./styles";

export const DEFAULT_SESSION = "dashboard:default";
const FILTER_KEY = "vito-chat-display-filters";
const SESSION_CHANNEL_FILTER_KEY = "vito-chat-hidden-session-channels";

type Filters = { thoughts: boolean; tools: boolean };
import { MessageRow } from "./ChatMessage";

function sessionName(session: Session): string {
  return session.alias?.trim() || session.id;
}

function ChannelIcon({ channel }: { channel: string }) {
  const styles = useThemeStyles(createChatStyles);
  const theme = useVitoTheme();
  const size = 19;
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
  return <Text style={styles.avatarText}>V</Text>;
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

async function loadHiddenSessionChannels(): Promise<string[]> {
  const raw =
    Platform.OS === "web"
      ? globalThis.localStorage?.getItem(SESSION_CHANNEL_FILTER_KEY)
      : await SecureStore.getItemAsync(SESSION_CHANNEL_FILTER_KEY);
  try {
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

async function saveHiddenSessionChannels(channels: string[]): Promise<void> {
  const value = JSON.stringify(channels);
  if (Platform.OS === "web") globalThis.localStorage?.setItem(SESSION_CHANNEL_FILTER_KEY, value);
  else await SecureStore.setItemAsync(SESSION_CHANNEL_FILTER_KEY, value);
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
  const styles = useThemeStyles(createChatStyles);
  const { width } = useWindowDimensions();
  const desktop = width >= DESKTOP_BREAKPOINT;
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
    limit: 20,
    hideThoughts: !filters.thoughts,
    hideTools: !filters.tools,
    refetchInterval: 3_000,
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const loadOlderMessages = useLoadSessionMessages();
  const sendMessage = useSendChatMessage();

  useEffect(() => {
    setMessages([]);
  }, [sessionId, filters.thoughts, filters.tools]);

  useEffect(() => {
    const incoming = messagesQuery.data?.messages;
    if (!incoming) return;
    setMessages((current) => {
      const merged = new Map(current.map((message) => [message.id, message]));
      for (const message of incoming) merged.set(message.id, message);
      return [...merged.values()].sort((a, b) => a.id - b.id);
    });
  }, [messagesQuery.data]);

  const loadOlder = async () => {
    if (!sessionId || !messages.length || loadOlderMessages.isPending) return;
    const page = await loadOlderMessages.mutateAsync({
      sessionId,
      limit: 20,
      before: messages[0].id,
      hideThoughts: !filters.thoughts,
      hideTools: !filters.tools,
    });
    setMessages((current) => {
      const merged = new Map(
        [...page.messages, ...current].map((message) => [message.id, message]),
      );
      return [...merged.values()].sort((a, b) => a.id - b.id);
    });
  };
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
      loadingOlder={loadOlderMessages.isPending}
      hasOlder={messages.length < (messagesQuery.data?.total ?? 0)}
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
      onLoadOlder={async () => {
        try {
          await loadOlder();
        } catch (cause) {
          handleError(cause);
          throw cause;
        }
      }}
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
  const styles = useThemeStyles(createChatStyles);
  const theme = useVitoTheme();
  const [hiddenChannels, setHiddenChannels] = useState<string[]>([]);
  const [filterReady, setFilterReady] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const channels = useMemo(
    () => [...new Set(sessions.map((session) => session.channel))].sort(),
    [sessions],
  );
  const visibleSessions = sessions.filter((session) => !hiddenChannels.includes(session.channel));

  useEffect(() => {
    void loadHiddenSessionChannels().then((value) => {
      setHiddenChannels(value);
      setFilterReady(true);
    });
  }, []);

  useEffect(() => {
    if (filterReady) void saveHiddenSessionChannels(hiddenChannels);
  }, [filterReady, hiddenChannels]);

  const toggleChannel = (channel: string) =>
    setHiddenChannels((current) =>
      current.includes(channel)
        ? current.filter((item) => item !== channel)
        : [...current, channel],
    );

  return (
    <View style={styles.listRoot}>
      <View style={styles.sessionToolbar}>
        <Pressable
          accessibilityLabel="Filter conversations"
          onPress={() => setFilterOpen(true)}
          style={styles.sessionFilterButton}
        >
          <Ionicons
            name={hiddenChannels.length ? "filter" : "filter-outline"}
            size={19}
            color={hiddenChannels.length ? theme.colors.accent : theme.colors.textSecondary}
          />
          {!!hiddenChannels.length && (
            <View style={styles.sessionFilterBadge}>
              <Text style={styles.sessionFilterBadgeText}>{hiddenChannels.length}</Text>
            </View>
          )}
        </Pressable>
      </View>
      <Modal
        visible={filterOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setFilterOpen(false)}
      >
        <Pressable style={styles.filterBackdrop} onPress={() => setFilterOpen(false)}>
          <Pressable style={styles.filterModal} onPress={() => undefined}>
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>Conversation types</Text>
              <Pressable onPress={() => setFilterOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={theme.colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView>
              {channels.map((channel) => {
                const visible = !hiddenChannels.includes(channel);
                return (
                  <Pressable
                    key={channel}
                    onPress={() => toggleChannel(channel)}
                    style={styles.filterRow}
                  >
                    <Text style={styles.filterRowText}>{channel.replaceAll("-", " ")}</Text>
                    <Ionicons
                      name={visible ? "checkbox" : "square-outline"}
                      size={22}
                      color={visible ? theme.colors.accent : theme.colors.textMuted}
                    />
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable onPress={() => setHiddenChannels([])} style={styles.showAllButton}>
              <Text style={styles.showAllButtonText}>Show everything</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <ScrollView contentContainerStyle={styles.sessionList}>
        {visibleSessions.map((session) => (
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
        {!!sessions.length && !visibleSessions.length && (
          <View style={styles.emptySessionFilter}>
            <Text style={styles.emptyText}>All conversation types are hidden.</Text>
            <Pressable onPress={() => setHiddenChannels([])}>
              <Text style={styles.clearSessionFilters}>Show everything</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Conversation({
  session,
  messages,
  loading,
  loadingOlder,
  hasOlder,
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
  onLoadOlder,
}: {
  session: Session;
  messages: Message[];
  loading: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
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
  onLoadOlder: () => Promise<void>;
}) {
  const styles = useThemeStyles(createChatStyles);
  const theme = useVitoTheme();
  const [webInputHeight, setWebInputHeight] = useState(22);
  const nearBottomRef = useRef(true);
  const scrollOffsetRef = useRef(0);
  const contentHeightRef = useRef(0);
  const prependingRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === "web" && input.length === 0) setWebInputHeight(22);
  }, [input]);

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
          <Ionicons
            name="chevron-back"
            size={27}
            color={theme.colors.accent}
            style={!onBack ? styles.hidden : undefined}
          />
        </Pressable>
        <Text style={styles.conversationTitle} numberOfLines={1}>
          {sessionName(session)}
        </Text>
        <Pressable
          accessibilityLabel="Conversation options"
          onPress={onMenu}
          style={styles.headerButton}
        >
          <Ionicons name="ellipsis-horizontal" size={23} color={theme.colors.accent} />
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
        scrollEventThrottle={16}
        onScroll={(event) => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          scrollOffsetRef.current = contentOffset.y;
          contentHeightRef.current = contentSize.height;
          nearBottomRef.current =
            contentSize.height - layoutMeasurement.height - contentOffset.y < 80;
          if (contentOffset.y < 80 && hasOlder && !loadingOlder && !prependingRef.current) {
            prependingRef.current = true;
            void onLoadOlder().catch(() => {
              prependingRef.current = false;
            });
          }
        }}
        onContentSizeChange={(_width, height) => {
          const previousHeight = contentHeightRef.current;
          contentHeightRef.current = height;
          if (prependingRef.current && height > previousHeight) {
            scrollRef.current?.scrollTo({
              y: scrollOffsetRef.current + height - previousHeight,
              animated: false,
            });
            prependingRef.current = false;
          } else if (nearBottomRef.current) {
            scrollRef.current?.scrollToEnd({ animated: false });
          }
        }}
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
      <View style={[styles.composer, Platform.OS === "web" && styles.composerWeb]}>
        <TextInput
          value={input}
          onChangeText={onInput}
          placeholder="Message Vito"
          placeholderTextColor={theme.colors.textMuted}
          multiline
          maxLength={12000}
          onContentSizeChange={(event) => {
            if (Platform.OS === "web")
              setWebInputHeight(Math.min(96, Math.max(22, event.nativeEvent.contentSize.height)));
          }}
          style={[
            styles.input,
            Platform.OS === "web" && styles.inputWeb,
            Platform.OS === "web" && { height: webInputHeight },
          ]}
        />
        <Pressable
          disabled={!input.trim() || sending}
          onPress={onSend}
          style={[styles.send, (!input.trim() || sending) && styles.sendDisabled]}
        >
          {sending ? (
            <ActivityIndicator color={theme.colors.accentText} />
          ) : (
            <Ionicons name="arrow-up" size={22} color={theme.colors.accentText} />
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
  const styles = useThemeStyles(createChatStyles);
  return (
    <Pressable onPress={() => onValue(!value)} style={styles.menuRow}>
      <Text style={styles.menuLabel}>{label}</Text>
      <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
        <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
      </View>
    </Pressable>
  );
}
