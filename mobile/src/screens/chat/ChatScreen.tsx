import { StyleSheet } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { FontAwesome6, Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { HeaderButton } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ApiError,
  useLoadSessionMessages,
  useSendChatMessage,
  useSessionMessages,
  useSessions,
  useUploadAttachment,
  type VitoMessage as Message,
  type VitoSession as Session,
} from "@vito/client";
import { useAgentName } from "../../contexts/agentIdentity";
import { useCurrentRuns, type CurrentRun } from "../../hooks/useCurrentRuns";
import {
  DESKTOP_BREAKPOINT,
  useThemeStyles,
  useVitoTheme,
  type VitoTheme,
} from "../../hooks/useVitoTheme";

export const DEFAULT_SESSION = "dashboard:default";
const FILTER_KEY = "vito-chat-display-filters";
const SESSION_CHANNEL_FILTER_KEY = "vito-chat-hidden-session-channels";
const SLASH_COMMANDS = [
  { command: "/new", label: "New conversation", description: "Archive this chat and start fresh" },
  {
    command: "/compact",
    label: "Compact conversation",
    description: "Summarize older context to free space",
  },
  {
    command: "/model",
    label: "Change model",
    description: "Inspect or switch the model",
    takesArgument: true,
  },
  { command: "/stop", label: "Stop", description: "Abort the active request and clear its queue" },
  {
    command: "/restart",
    label: "Restart Vito",
    description: "Run the full rebuild and restart workflow",
  },
] as const;

type Filters = { thoughts: boolean; tools: boolean };
type PendingAttachment = {
  data: string;
  filename: string;
  mimeType: string;
  type: "image" | "file";
};
import { MessageRow } from "./ChatMessage";

function sessionName(session: Session): string {
  return session.alias?.trim() || session.id;
}

function ChannelIcon({ channel }: { channel: string }) {
  const styles = useThemeStyles(createStyles);
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

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read attachment"));
    reader.readAsDataURL(file);
  });
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
  const theme = useVitoTheme();
  const desktop = false;
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
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
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
  const { runs } = useCurrentRuns();
  const runStatusBySession = useMemo(() => {
    const statuses = new Map<string, CurrentRun["status"]>();
    for (const run of runs) {
      if (run.status === "active" || !statuses.has(run.sessionKey)) {
        statuses.set(run.sessionKey, run.status);
      }
    }
    return statuses;
  }, [runs]);
  const messagesQuery = useSessionMessages(filtersReady ? sessionId : null, {
    limit: 20,
    hideThoughts: !filters.thoughts,
    hideTools: !filters.tools,
    refetchInterval: 3_000,
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const loadOlderMessages = useLoadSessionMessages();
  const sendMessage = useSendChatMessage();
  const uploadAttachment = useUploadAttachment();

  const addWebFiles = useCallback(async (files: File[]) => {
    const next = await Promise.all(
      files.map(async (file) => ({
        data: await fileToDataUrl(file),
        filename: file.name || "pasted-file",
        mimeType: file.type || "application/octet-stream",
        type: file.type.startsWith("image/") ? ("image" as const) : ("file" as const),
      })),
    );
    setAttachments((current) => [...current, ...next]);
  }, []);

  const pickAttachments = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const next = await Promise.all(
      result.assets.map(async (asset) => {
        const mimeType = asset.mimeType || "application/octet-stream";
        const data = asset.file
          ? await fileToDataUrl(asset.file)
          : `data:${mimeType};base64,${await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 })}`;
        return {
          data,
          filename: asset.name,
          mimeType,
          type: mimeType.startsWith("image/") ? ("image" as const) : ("file" as const),
        };
      }),
    );
    setAttachments((current) => [...current, ...next]);
  };

  const pasteClipboardImage = async () => {
    const image = await Clipboard.getImageAsync({ format: "png" });
    if (!image) {
      setLocalError("The clipboard does not contain an image.");
      return;
    }
    setLocalError(null);
    setAttachments((current) => [
      ...current,
      {
        data: image.data,
        filename: `pasted-image-${Date.now()}.png`,
        mimeType: "image/png",
        type: "image",
      },
    ]);
  };

  const showAttachmentMenu = () => {
    if (Platform.OS === "web") {
      void pickAttachments().catch(handleError);
      return;
    }
    Alert.alert("Add attachment", undefined, [
      {
        text: "Paste Image",
        onPress: () => void pasteClipboardImage().catch(handleError),
      },
      {
        text: "Choose File",
        onPress: () => void pickAttachments().catch(handleError),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const paste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length) {
        event.preventDefault();
        void addWebFiles(files);
      }
    };
    globalThis.addEventListener("paste", paste as EventListener);
    return () => globalThis.removeEventListener("paste", paste as EventListener);
  }, [addWebFiles]);

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
  const createChat = () => {
    const target = `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    selectSession({
      id: `dashboard:${target}`,
      channel: "dashboard",
      channel_target: target,
      alias: "New chat",
      last_active_at: Date.now(),
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
    if (
      (!content && !attachments.length) ||
      sendMessage.isPending ||
      uploadAttachment.isPending ||
      !sessionId
    )
      return;
    const pendingAttachments = [...attachments];
    setInput("");
    setAttachments([]);
    setLocalError(null);
    let messageSent = false;
    try {
      const uploaded = await Promise.all(
        pendingAttachments.map(async (attachment) => {
          const result = await uploadAttachment.mutateAsync({
            data: attachment.data,
            filename: attachment.filename,
          });
          return {
            type: attachment.type,
            path: result.path,
            url: result.url,
            filename: result.filename,
            mimeType: result.mimeType,
          };
        }),
      );
      await sendMessage.mutateAsync({
        sessionId,
        content,
        attachments: uploaded.length ? uploaded : undefined,
      });
      messageSent = true;
      await Promise.all([messagesQuery.refetch(), sessionsQuery.refetch()]);
    } catch (cause) {
      if (!messageSent) {
        setInput(content);
        setAttachments(pendingAttachments);
      }
      setLocalError(
        messageSent
          ? "Message sent, but the conversation could not be refreshed."
          : cause instanceof Error
            ? cause.message
            : "Request failed",
      );
      handleError(cause);
    }
  };

  const navigation = useNavigation();
  useLayoutEffect(() => {
    if (!selectedSessionId) return;
    navigation.setOptions({
      title: sessionName(
        selectedSession ?? {
          id: selectedSessionId,
          channel: "dashboard",
          alias: "New chat",
          last_active_at: 0,
        },
      ),
      headerRight: ({ tintColor }: { tintColor?: string }) => (
        <HeaderButton
          accessibilityLabel={menuOpen ? "Close conversation options" : "Conversation options"}
          onPress={() => setMenuOpen((open) => !open)}
          tintColor={tintColor}
        >
          <Ionicons name="ellipsis-horizontal" size={23} color={tintColor ?? theme.colors.accent} />
        </HeaderButton>
      ),
    });
  }, [menuOpen, navigation, selectedSession, selectedSessionId, theme.colors.accent]);

  const conversation = sessionId ? (
    <Conversation
      session={
        selectedSession ?? {
          id: sessionId,
          channel: "dashboard",
          alias: "New chat",
          last_active_at: 0,
        }
      }
      messages={messages}
      loading={
        !filtersReady ||
        messagesQuery.isLoading ||
        (!messagesQuery.data && messagesQuery.isFetching)
      }
      loadingOlder={loadOlderMessages.isPending}
      hasOlder={messages.length < (messagesQuery.data?.total ?? 0)}
      filters={filters}
      menuOpen={menuOpen}
      input={input}
      attachments={attachments}
      sending={sendMessage.isPending || uploadAttachment.isPending}
      error={localError}
      runStatus={runStatusBySession.get(sessionId) ?? null}
      scrollRef={scrollRef}
      onBack={
        onBack
          ? () => {
              onBack();
              setMenuOpen(false);
            }
          : undefined
      }
      onMenu={() => setMenuOpen((open) => !open)}
      onFilters={setFilters}
      onInput={setInput}
      onAttach={showAttachmentMenu}
      onRemoveAttachment={(index) =>
        setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))
      }
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
          <SessionList
            sessions={sessions}
            selectedId={sessionId}
            loading={sessionsQuery.isLoading}
            runStatusBySession={runStatusBySession}
            onCreate={createChat}
            onSelect={selectSession}
          />
        </View>
        <View style={styles.desktopConversation}>{conversation}</View>
      </View>
    );
  }

  return (
    conversation ?? (
      <SessionList
        sessions={sessions}
        selectedId={null}
        loading={sessionsQuery.isLoading}
        runStatusBySession={runStatusBySession}
        onCreate={createChat}
        onSelect={selectSession}
      />
    )
  );
}

function SessionList({
  sessions,
  selectedId,
  loading,
  runStatusBySession,
  onCreate,
  onSelect,
}: {
  sessions: Session[];
  selectedId: string | null;
  loading: boolean;
  runStatusBySession: ReadonlyMap<string, CurrentRun["status"]>;
  onCreate: () => void;
  onSelect: (session: Session) => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const agentName = useAgentName();
  const navigation = useNavigation();
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

  useFocusEffect(
    useCallback(() => {
      navigation.getParent()?.setOptions({
        title: "Chats",
        headerLeft: ({ tintColor }: { tintColor?: string }) => (
          <HeaderButton
            accessibilityLabel="Filter conversations"
            onPress={() => setFilterOpen(true)}
            tintColor={tintColor}
          >
            <View style={styles.filterHeaderIcon}>
              <Ionicons
                name={hiddenChannels.length ? "filter" : "filter-outline"}
                size={22}
                color={tintColor ?? theme.colors.accent}
              />
              {!!hiddenChannels.length && (
                <View style={styles.sessionFilterBadge}>
                  <Text style={styles.sessionFilterBadgeText}>{hiddenChannels.length}</Text>
                </View>
              )}
            </View>
          </HeaderButton>
        ),
        headerRight: ({ tintColor }: { tintColor?: string }) => (
          <HeaderButton accessibilityLabel="New chat" onPress={onCreate} tintColor={tintColor}>
            <Ionicons name="add" size={25} color={tintColor ?? theme.colors.accent} />
          </HeaderButton>
        ),
      });
    }, [hiddenChannels.length, navigation, onCreate, styles, theme.colors.accent]),
  );

  const toggleChannel = (channel: string) =>
    setHiddenChannels((current) =>
      current.includes(channel)
        ? current.filter((item) => item !== channel)
        : [...current, channel],
    );

  return (
    <View style={styles.listRoot}>
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
              {runStatusBySession.has(session.id) ? (
                <View style={styles.sessionActivity}>
                  <View style={styles.typingDots}>
                    <View style={styles.typingDot} />
                    <View style={styles.typingDot} />
                    <View style={styles.typingDot} />
                  </View>
                  <Text style={styles.sessionActivityText} numberOfLines={1}>
                    {runStatusBySession.get(session.id) === "active"
                      ? `${agentName} is working…`
                      : "Waiting to start…"}
                  </Text>
                </View>
              ) : (
                <Text style={styles.sessionPreview} numberOfLines={1}>
                  {session.last_message?.replace(/\s+/g, " ").trim() || "No messages yet"}
                </Text>
              )}
            </View>
          </Pressable>
        ))}
        {loading && <ActivityIndicator color={theme.colors.accent} style={styles.listLoader} />}
        {!loading && !sessions.length && (
          <View style={styles.emptySessionFilter}>
            <Text style={styles.emptyText}>No conversations yet.</Text>
          </View>
        )}
        {!loading && !!sessions.length && !visibleSessions.length && (
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
  attachments,
  sending,
  error,
  runStatus,
  scrollRef,
  onBack,
  onMenu,
  onFilters,
  onInput,
  onAttach,
  onRemoveAttachment,
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
  attachments: PendingAttachment[];
  sending: boolean;
  error: string | null;
  runStatus: CurrentRun["status"] | null;
  scrollRef: React.RefObject<ScrollView | null>;
  onBack?: () => void;
  onMenu: () => void;
  onFilters: (filters: Filters) => void;
  onInput: (value: string) => void;
  onAttach: () => void;
  onRemoveAttachment: (index: number) => void;
  onSend: () => void;
  onLoadOlder: () => Promise<void>;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const agentName = useAgentName();
  const insets = useSafeAreaInsets();
  const [webInputHeight, setWebInputHeight] = useState(22);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const lastKeyboardHeightRef = useRef(0);
  const inputFocusedRef = useRef(false);
  const composerInputRef = useRef<TextInput>(null);
  const nearBottomRef = useRef(true);
  const scrollOffsetRef = useRef(0);
  const contentHeightRef = useRef(0);
  const prependingRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === "web" && input.length === 0) setWebInputHeight(22);
  }, [input]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;

    const syncKeyboardInset = () => {
      const measuredHeight = Math.max(0, Keyboard.metrics()?.height ?? 0);
      if (measuredHeight > 0) lastKeyboardHeightRef.current = measuredHeight;
      setKeyboardInset(
        measuredHeight > 0
          ? measuredHeight
          : inputFocusedRef.current
            ? lastKeyboardHeightRef.current
            : 0,
      );
    };

    const resumeTimers = new Set<ReturnType<typeof setTimeout>>();
    syncKeyboardInset();
    const frame = Keyboard.addListener("keyboardWillChangeFrame", (event) => {
      const height = Math.max(0, event.endCoordinates.height);
      if (height > 0) lastKeyboardHeightRef.current = height;
      setKeyboardInset(height);
    });
    const hide = Keyboard.addListener("keyboardWillHide", () => setKeyboardInset(0));
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      syncKeyboardInset();
      for (const delay of [100, 300]) {
        const timer = setTimeout(() => {
          resumeTimers.delete(timer);
          syncKeyboardInset();
        }, delay);
        resumeTimers.add(timer);
      }
    });
    return () => {
      frame.remove();
      hide.remove();
      appState.remove();
      for (const timer of resumeTimers) clearTimeout(timer);
    };
  }, []);

  const keepWebComposerFocused = () => {
    if (Platform.OS !== "web") return;
    globalThis.requestAnimationFrame(() => composerInputRef.current?.focus());
  };
  const sendFromComposer = () => {
    onSend();
    keepWebComposerFocused();
  };

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handleUnfocusedEnter = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.isComposing ||
        event.repeat ||
        menuOpen ||
        sending ||
        (!input.trim() && attachments.length === 0)
      )
        return;
      const activeElement = globalThis.document?.activeElement;
      if (
        activeElement &&
        activeElement !== globalThis.document.body &&
        activeElement !== globalThis.document.documentElement
      )
        return;
      event.preventDefault();
      composerInputRef.current?.focus();
      onSend();
    };
    globalThis.addEventListener("keydown", handleUnfocusedEnter);
    return () => globalThis.removeEventListener("keydown", handleUnfocusedEnter);
  }, [attachments.length, input, menuOpen, onSend, sending]);

  const slashQuery = input.startsWith("/") && !input.includes(" ") ? input.toLowerCase() : null;
  const slashCommands = slashQuery
    ? SLASH_COMMANDS.filter((item) => item.command.startsWith(slashQuery))
    : [];

  return (
    <View
      style={[
        styles.conversationRoot,
        Platform.OS === "ios" && keyboardInset > 0 && { paddingBottom: keyboardInset },
      ]}
    >
      {onBack && (
        <View style={styles.conversationHeader}>
          <Pressable
            accessibilityLabel="Back to conversations"
            onPress={onBack}
            style={styles.headerButton}
          >
            <Ionicons name="chevron-back" size={27} color={theme.colors.accent} />
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
      )}
      <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={onMenu}>
        <Pressable style={styles.menuBackdrop} onPress={onMenu}>
          <Pressable style={styles.menu} onPress={(event) => event.stopPropagation()}>
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
          </Pressable>
        </Pressable>
      </Modal>
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messageContent}
        keyboardDismissMode="on-drag"
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
            <Text style={styles.emptyText}>Start this conversation with {agentName}.</Text>
          </View>
        )}
      </ScrollView>
      {runStatus && (
        <View
          accessibilityLabel={
            runStatus === "active"
              ? `${agentName} is working on this conversation`
              : "This conversation is waiting to start"
          }
          style={styles.conversationActivity}
        >
          <View style={styles.typingDots}>
            <View style={styles.typingDot} />
            <View style={styles.typingDot} />
            <View style={styles.typingDot} />
          </View>
          <Text style={styles.conversationActivityText}>
            {runStatus === "active" ? `${agentName} is working…` : "Waiting to start…"}
          </Text>
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {!!slashCommands.length && (
        <View style={styles.slashMenu}>
          {slashCommands.map((item) => (
            <Pressable
              key={item.command}
              accessibilityLabel={`${item.command}, ${item.label}`}
              onPress={() =>
                onInput(
                  `${item.command}${"takesArgument" in item && item.takesArgument ? " " : ""}`,
                )
              }
              style={({ pressed }) => [styles.slashRow, pressed && styles.slashRowPressed]}
            >
              <View style={styles.slashCommandBadge}>
                <Text style={styles.slashCommandText}>{item.command}</Text>
              </View>
              <View style={styles.slashCopy}>
                <Text style={styles.slashLabel}>{item.label}</Text>
                <Text numberOfLines={1} style={styles.slashDescription}>
                  {item.description}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
      {!!attachments.length && (
        <ScrollView
          horizontal
          style={styles.pendingAttachmentsScroll}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pendingAttachments}
        >
          {attachments.map((attachment, index) => (
            <View key={`${attachment.filename}:${index}`} style={styles.pendingAttachment}>
              {attachment.type === "image" ? (
                <Image source={{ uri: attachment.data }} style={styles.pendingImage} />
              ) : (
                <Ionicons name="document-outline" size={24} color={theme.colors.accent} />
              )}
              <Text style={styles.pendingName} numberOfLines={1}>
                {attachment.filename}
              </Text>
              <Pressable onPress={() => onRemoveAttachment(index)} style={styles.removeAttachment}>
                <Ionicons name="close" size={13} color={theme.colors.text} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
      <View
        style={[
          styles.composer,
          Platform.OS === "web" && styles.composerWeb,
          {
            marginBottom:
              keyboardInset > 0 ? theme.space.sm : Math.max(theme.space.sm, insets.bottom),
          },
        ]}
      >
        <Pressable
          accessibilityLabel="Attach files or photos"
          onPress={onAttach}
          style={styles.attachButton}
        >
          <Ionicons name="add" size={24} color={theme.colors.textSecondary} />
        </Pressable>
        <TextInput
          ref={composerInputRef}
          value={input}
          onChangeText={onInput}
          onFocus={() => {
            inputFocusedRef.current = true;
          }}
          onBlur={() => {
            inputFocusedRef.current = false;
          }}
          placeholder={`Message ${agentName}`}
          placeholderTextColor={theme.colors.textMuted}
          multiline
          maxLength={12000}
          onKeyPress={(event) => {
            if (Platform.OS !== "web" || event.nativeEvent.key !== "Enter") return;
            const keyboardEvent = event.nativeEvent as typeof event.nativeEvent & {
              shiftKey?: boolean;
              isComposing?: boolean;
            };
            if (keyboardEvent.shiftKey || keyboardEvent.isComposing) return;
            event.preventDefault();
            if ((input.trim() || attachments.length) && !sending) sendFromComposer();
          }}
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
          disabled={(!input.trim() && !attachments.length) || sending}
          onPress={sendFromComposer}
          style={[
            styles.send,
            ((!input.trim() && !attachments.length) || sending) && styles.sendDisabled,
          ]}
        >
          {sending ? (
            <ActivityIndicator color={theme.colors.accentText} />
          ) : (
            <Ionicons name="arrow-up" size={22} color={theme.colors.accentText} />
          )}
        </Pressable>
      </View>
    </View>
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

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    avatarText: { color: theme.colors.accent, fontWeight: "800", fontSize: 17 },
    desktopRoot: { flex: 1, flexDirection: "row", backgroundColor: theme.colors.canvas },
    desktopList: { width: 340, flexShrink: 0 },
    desktopConversation: {
      flex: 1,
      minWidth: 0,
      borderLeftWidth: 1,
      borderLeftColor: theme.colors.separator,
    },
    listRoot: { flex: 1, backgroundColor: theme.colors.canvas },
    filterHeaderIcon: {
      minHeight: 26,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.space.xs,
    },
    sessionFilterBadge: {
      minWidth: 14,
      height: 14,
      paddingHorizontal: theme.space.xs,
      borderRadius: 7,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.accent,
    },
    sessionFilterBadgeText: { color: theme.colors.accentText, fontSize: 8, fontWeight: "900" },
    filterBackdrop: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: theme.space.lg,
      backgroundColor: "rgba(0,0,0,0.55)",
    },
    filterModal: {
      width: "100%",
      maxWidth: 420,
      maxHeight: "80%",
      padding: theme.space.lg,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      backgroundColor: theme.colors.surface,
    },
    filterModalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: theme.space.md,
    },
    filterModalTitle: { color: theme.colors.text, fontSize: 17, fontWeight: "800" },
    filterRow: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    filterRowText: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      fontWeight: "600",
      textTransform: "capitalize",
    },
    showAllButton: { alignSelf: "flex-start", paddingTop: theme.space.lg },
    showAllButtonText: { color: theme.colors.accent, fontSize: 13, fontWeight: "700" },
    sessionList: { paddingLeft: theme.space.lg, paddingTop: theme.space.sm },
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
    sessionActivity: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      marginTop: theme.space.xs,
    },
    sessionActivityText: { color: theme.colors.accent, fontSize: 12, fontWeight: "700" },
    typingDots: { flexDirection: "row", alignItems: "center", gap: theme.space.xs },
    typingDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: theme.colors.accent },
    listLoader: { marginTop: theme.space.giant },
    emptySessionFilter: { alignItems: "center", gap: theme.space.sm, padding: theme.space.giant },
    emptyText: { color: theme.colors.textMuted, fontSize: 12, marginTop: theme.space.xs },
    clearSessionFilters: { color: theme.colors.accent, fontSize: 13, fontWeight: "700" },
    conversationRoot: {
      flex: 1,
      minHeight: 0,
      backgroundColor: theme.colors.canvas,
      overflow: "hidden",
    },
    conversationHeader: {
      height: 50,
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
      backgroundColor: theme.colors.sidebar,
    },
    headerButton: { width: 50, height: 50, alignItems: "center", justifyContent: "center" },
    hidden: { opacity: 0 },
    conversationTitle: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 16,
      fontWeight: "700",
      textAlign: "center",
    },
    menuBackdrop: { flex: 1, backgroundColor: "transparent" },
    menu: {
      position: "absolute",
      top: 100,
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
    menuRule: { height: 1, backgroundColor: theme.colors.separatorStrong },
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
    conversationActivity: {
      minHeight: 28,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      paddingHorizontal: theme.space.lg,
    },
    conversationActivityText: { color: theme.colors.accent, fontSize: 11, fontWeight: "700" },
    error: {
      color: theme.colors.danger,
      fontSize: 11,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.xs,
    },
    slashMenu: {
      marginHorizontal: theme.space.md,
      marginBottom: theme.space.xs,
      borderRadius: 15,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      backgroundColor: theme.colors.surfaceRaised,
    },
    slashRow: {
      minHeight: 58,
      paddingHorizontal: theme.space.md,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    slashRowPressed: { backgroundColor: theme.colors.surface },
    slashCommandBadge: {
      minWidth: 72,
      height: 30,
      paddingHorizontal: theme.space.sm,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.accentSurface,
    },
    slashCommandText: { color: theme.colors.accent, fontSize: 11, fontWeight: "900" },
    slashCopy: { flex: 1, minWidth: 0 },
    slashLabel: { color: theme.colors.text, fontSize: 12, fontWeight: "800" },
    slashDescription: { color: theme.colors.textMuted, fontSize: 10, marginTop: theme.space.xs },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: theme.space.sm,
      marginHorizontal: theme.space.md,
      marginVertical: theme.space.sm,
      minHeight: 44,
      paddingLeft: theme.space.xs,
      paddingRight: theme.space.xs,
      paddingVertical: theme.space.xs,
      borderRadius: 23,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      backgroundColor: theme.colors.surface,
    },
    pendingAttachmentsScroll: { flexGrow: 0, height: 80 },
    pendingAttachments: {
      gap: theme.space.sm,
      paddingHorizontal: theme.space.md,
      paddingTop: theme.space.sm,
    },
    pendingAttachment: {
      width: 112,
      height: 72,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.xs,
      padding: theme.space.sm,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      backgroundColor: theme.colors.surface,
      position: "relative",
    },
    pendingImage: { width: 48, height: 54, borderRadius: 6 },
    pendingName: { flex: 1, color: theme.colors.textSecondary, fontSize: 10 },
    removeAttachment: {
      position: "absolute",
      top: 3,
      right: 3,
      width: 20,
      height: 20,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surfaceRaised,
    },
    attachButton: {
      width: 35,
      height: 35,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 18,
    },
    composerWeb: { alignItems: "center" },
    input: {
      flex: 1,
      maxHeight: 112,
      minHeight: 34,
      color: theme.colors.text,
      fontSize: 15,
      paddingTop: theme.space.sm,
      paddingBottom: theme.space.sm,
    },
    inputWeb: {
      minHeight: 22,
      lineHeight: 20,
      paddingTop: theme.space.none,
      paddingBottom: theme.space.none,
      outlineWidth: 0,
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
    menuRow: {
      minHeight: 53,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    menuLabel: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
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
  });
