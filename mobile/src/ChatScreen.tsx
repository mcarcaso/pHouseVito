import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ApiError, getMessages, getSessions, sendMessage, type Message, type Session } from "./api";

const DEFAULT_SESSION = "dashboard:default";

function cleanContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    return typeof parsed === "string" ? parsed : content;
  } catch {
    return content;
  }
}

export function ChatScreen({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState(DEFAULT_SESSION);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const handleError = useCallback(
    (cause: unknown) => {
      if (cause instanceof ApiError && cause.status === 401) onUnauthorized();
      else setError(cause instanceof Error ? cause.message : "Request failed");
    },
    [onUnauthorized],
  );

  useEffect(() => {
    getSessions().then(setSessions).catch(handleError);
  }, [handleError]);

  const refresh = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        setMessages(await getMessages(sessionId));
        setError(null);
      } catch (cause) {
        handleError(cause);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [handleError, sessionId],
  );

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(true), 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  const send = async () => {
    const content = input.trim();
    if (!content || sending) return;
    setInput("");
    setSending(true);
    setError(null);
    try {
      await sendMessage(sessionId, content);
      await refresh(true);
    } catch (cause) {
      setInput(content);
      handleError(cause);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={80}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>SECURE CHANNEL</Text>
          <Text style={styles.title}>Chat</Text>
        </View>
        <View style={styles.live}>
          <View style={styles.dot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sessions}
      >
        {(sessions.length
          ? sessions
          : [{ id: DEFAULT_SESSION, alias: "Dashboard", channel: "dashboard", last_active_at: 0 }]
        ).map((session) => (
          <Pressable
            key={session.id}
            onPress={() => setSessionId(session.id)}
            style={[styles.session, session.id === sessionId && styles.sessionActive]}
          >
            <Text
              style={[styles.sessionText, session.id === sessionId && styles.sessionTextActive]}
              numberOfLines={1}
            >
              {session.alias || session.id}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messageContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {loading ? (
          <ActivityIndicator color="#b7f34a" style={styles.loader} />
        ) : messages.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Quiet in here.</Text>
            <Text style={styles.emptyText}>Send the first message to Vito.</Text>
          </View>
        ) : (
          messages.map((message) => {
            const user = message.type === "user";
            return (
              <View key={message.id} style={[styles.messageRow, user && styles.messageRowUser]}>
                <View style={[styles.bubble, user ? styles.userBubble : styles.assistantBubble]}>
                  {!user && <Text style={styles.author}>{message.author || "VITO"}</Text>}
                  <Text style={[styles.messageText, user && styles.userMessageText]}>
                    {cleanContent(message.content)}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Message Vito…"
          placeholderTextColor="#626962"
          multiline
          maxLength={12000}
          style={styles.input}
        />
        <Pressable
          disabled={!input.trim() || sending}
          onPress={() => void send()}
          style={({ pressed }) => [
            styles.send,
            (!input.trim() || sending) && styles.sendDisabled,
            pressed && styles.pressed,
          ]}
        >
          {sending ? <ActivityIndicator color="#11150d" /> : <Text style={styles.sendText}>↑</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 500 },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: 3,
    marginBottom: 16,
  },
  eyebrow: { color: "#a9e83a", fontSize: 9, fontWeight: "800", letterSpacing: 1.8 },
  title: { color: "#f0f2ef", fontSize: 34, fontWeight: "800", letterSpacing: -1.2, marginTop: 4 },
  live: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 15,
    backgroundColor: "#162413",
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#a9e83a" },
  liveText: { color: "#b7ed5a", fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  sessions: { gap: 8, paddingBottom: 13 },
  session: {
    height: 34,
    maxWidth: 190,
    paddingHorizontal: 13,
    borderRadius: 18,
    backgroundColor: "#151815",
    borderWidth: 1,
    borderColor: "#292e29",
    justifyContent: "center",
  },
  sessionActive: { backgroundColor: "#202a1c", borderColor: "#465f32" },
  sessionText: { color: "#858c85", fontSize: 11, fontWeight: "600" },
  sessionTextActive: { color: "#c3ef77" },
  messages: { flex: 1, borderTopWidth: 1, borderTopColor: "#202420" },
  messageContent: { paddingVertical: 18, gap: 13 },
  loader: { marginTop: 80 },
  empty: { alignItems: "center", paddingTop: 90 },
  emptyTitle: { color: "#d7dbd6", fontSize: 18, fontWeight: "700" },
  emptyText: { color: "#707770", fontSize: 13, marginTop: 6 },
  messageRow: { flexDirection: "row" },
  messageRowUser: { justifyContent: "flex-end" },
  bubble: { maxWidth: "86%", borderRadius: 17, paddingHorizontal: 15, paddingVertical: 12 },
  assistantBubble: {
    backgroundColor: "#151815",
    borderWidth: 1,
    borderColor: "#262b26",
    borderBottomLeftRadius: 5,
  },
  userBubble: { backgroundColor: "#b7f34a", borderBottomRightRadius: 5 },
  author: { color: "#8fbd43", fontSize: 9, fontWeight: "800", letterSpacing: 1.2, marginBottom: 5 },
  messageText: { color: "#d8dcd7", fontSize: 14, lineHeight: 20 },
  userMessageText: { color: "#151911" },
  error: { color: "#ef827b", fontSize: 11, paddingVertical: 7 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 9,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: "#252a25",
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#303630",
    backgroundColor: "#121512",
    color: "#eef1ed",
    paddingHorizontal: 15,
    paddingTop: 13,
    paddingBottom: 12,
    fontSize: 15,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: "#b7f34a",
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: { color: "#11150d", fontSize: 25, fontWeight: "800", marginTop: -2 },
  sendDisabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
});
