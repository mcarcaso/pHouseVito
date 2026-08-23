import { useCallback, useEffect, useRef, useState } from "react";
import { setAudioModeAsync } from "expo-audio";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  cancelVoiceTask,
  getRealtimeToken,
  getVoiceContext,
  getVoiceSession,
  getVoiceSessions,
  getVoiceTask,
  persistVoiceEvent,
  searchVoiceMemory,
  startVoiceTask,
  type VoiceSession,
} from "./api";
import { connectRealtime, type VoiceConnection } from "./realtime-webrtc";

type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "error";
interface TranscriptLine {
  id: number;
  role: "Mike" | "Vito";
  text: string;
}
interface RealtimeEvent {
  type?: string;
  transcript?: string;
  delta?: string;
  error?: { message?: string };
  response?: { usage?: unknown };
  name?: string;
  call_id?: string;
  arguments?: string;
  item?: {
    type?: string;
    name?: string;
    call_id?: string;
    arguments?: string;
  };
}

export function VoiceScreen({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [state, setState] = useState<VoiceState>("idle");
  const [muted, setMuted] = useState(false);
  const [audioRoute, setAudioRoute] = useState<"speaker" | "earpiece">("speaker");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [history, setHistory] = useState<VoiceSession[]>([]);
  const [sessionSummary, setSessionSummary] = useState<string | null>(null);
  const connectionRef = useRef<VoiceConnection | null>(null);
  const assistantDraftRef = useRef("");
  const lineIdRef = useRef(0);
  const sessionIdRef = useRef(`voice:${Date.now()}`);
  const handledToolCallsRef = useRef(new Set<string>());

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await getVoiceSessions());
    } catch {
      // Voice history is secondary to the live connection.
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const openHistory = useCallback(async (id: string) => {
    const detail = await getVoiceSession(id);
    if (!detail) return;
    setTranscript(
      detail.messages
        .filter((message) => message.type === "user" || message.type === "assistant")
        .map((message) => ({
          id: ++lineIdRef.current,
          role: message.type === "user" ? ("Mike" as const) : ("Vito" as const),
          text: message.content,
        })),
    );
    const seconds = detail.durationMs ? Math.round(detail.durationMs / 1_000) : null;
    const tokens = detail.usage.reduce<number>((total, usage) => {
      if (!usage || typeof usage !== "object" || !("total_tokens" in usage)) return total;
      const value = (usage as { total_tokens?: unknown }).total_tokens;
      return total + (typeof value === "number" ? value : 0);
    }, 0);
    setSessionSummary(
      [
        seconds === null ? null : `${seconds}s`,
        tokens > 0 ? `${tokens.toLocaleString()} tokens` : `${detail.usage.length} usage record(s)`,
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }, []);

  const addLine = useCallback((role: "Mike" | "Vito", text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setTranscript((current) => [...current, { id: ++lineIdRef.current, role, text: clean }]);
    void persistVoiceEvent(
      sessionIdRef.current,
      role === "Mike" ? "user" : "assistant",
      clean,
    ).catch(() => undefined);
  }, []);

  const stop = useCallback(() => {
    const startedAt = Number(sessionIdRef.current.slice("voice:".length));
    if (Number.isFinite(startedAt)) {
      void persistVoiceEvent(
        sessionIdRef.current,
        "session_end",
        JSON.stringify({ durationMs: Math.max(0, Date.now() - startedAt) }),
      ).catch(() => undefined);
    }
    connectionRef.current?.close();
    connectionRef.current = null;
    assistantDraftRef.current = "";
    setMuted(false);
    setState("idle");
    void loadHistory();
  }, [loadHistory]);

  const sendToolResult = useCallback((callId: string, result: unknown) => {
    connectionRef.current?.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(result),
      },
    });
    connectionRef.current?.sendEvent({ type: "response.create" });
  }, []);

  const waitForTask = useCallback(async (id: string) => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const task = await getVoiceTask(id);
      if (!task || task.status === "queued" || task.status === "running") continue;
      connectionRef.current?.sendEvent({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                task.status === "completed"
                  ? `Vito task ${id} completed: ${task.result ?? "No result"}`
                  : `Vito task ${id} ended with status ${task.status}: ${task.error ?? "No details"}`,
            },
          ],
        },
      });
      connectionRef.current?.sendEvent({ type: "response.create" });
      return;
    }
  }, []);

  const executeTool = useCallback(
    async (name: string, callId: string, rawArguments?: string) => {
      if (handledToolCallsRef.current.has(callId)) return;
      handledToolCallsRef.current.add(callId);
      let args: Record<string, unknown> = {};
      try {
        args = rawArguments ? (JSON.parse(rawArguments) as Record<string, unknown>) : {};
        let result: unknown;
        if (name === "get_vito_context") result = await getVoiceContext();
        else if (name === "search_memory") {
          result = await searchVoiceMemory(
            String(args.query ?? ""),
            args.mode === "semantic" || args.mode === "exact" ? args.mode : "hybrid",
            typeof args.day === "string" ? args.day : undefined,
          );
        } else if (name === "ask_vito_async") {
          const task = await startVoiceTask(sessionIdRef.current, String(args.question ?? ""));
          result = { taskId: task.id, status: task.status, message: "Vito is working on it." };
          void waitForTask(task.id);
        } else if (name === "get_task") result = await getVoiceTask(String(args.id ?? ""));
        else if (name === "cancel_task") result = await cancelVoiceTask(String(args.id ?? ""));
        else throw new Error(`Unknown tool: ${name}`);
        void persistVoiceEvent(
          sessionIdRef.current,
          "usage",
          JSON.stringify({ tool_success: { name, arguments: args } }),
        ).catch(() => undefined);
        sendToolResult(callId, result);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Voice tool failed";
        addLine("Vito", `Tool ${name} failed: ${message}`);
        void persistVoiceEvent(
          sessionIdRef.current,
          "usage",
          JSON.stringify({ tool_error: { name, message } }),
        ).catch(() => undefined);
        sendToolResult(callId, { error: message });
      }
    },
    [addLine, sendToolResult, waitForTask],
  );

  const handleEvent = useCallback(
    (raw: unknown) => {
      if (typeof raw !== "string") return;
      let event: RealtimeEvent;
      try {
        event = JSON.parse(raw) as RealtimeEvent;
      } catch {
        return;
      }

      if (event.type === "input_audio_buffer.speech_started") setState("listening");
      if (event.type === "response.output_audio.delta") setState("speaking");
      if (event.type === "response.done") {
        setState("listening");
        if (event.response?.usage) {
          void persistVoiceEvent(
            sessionIdRef.current,
            "usage",
            JSON.stringify(event.response.usage),
          ).catch(() => undefined);
        }
      }
      if (
        event.type === "conversation.item.input_audio_transcription.completed" &&
        event.transcript
      ) {
        addLine("Mike", event.transcript);
      }
      if (event.type === "response.output_audio_transcript.delta" && event.delta) {
        assistantDraftRef.current += event.delta;
      }
      if (event.type === "response.output_audio_transcript.done") {
        addLine("Vito", event.transcript ?? assistantDraftRef.current);
        assistantDraftRef.current = "";
      }
      if (event.type === "response.function_call_arguments.done" && event.name && event.call_id) {
        void executeTool(event.name, event.call_id, event.arguments);
      }
      if (
        event.type === "response.output_item.done" &&
        event.item?.type === "function_call" &&
        event.item.name &&
        event.item.call_id
      ) {
        void executeTool(event.item.name, event.item.call_id, event.item.arguments);
      }
      if (event.type === "error") {
        setError(event.error?.message ?? "OpenAI Realtime reported an error");
        setState("error");
      }
    },
    [addLine, executeTool],
  );

  const start = async () => {
    if (state !== "idle" && state !== "error") return;
    setState("connecting");
    setError(null);
    setTranscript([]);
    setSessionSummary(null);
    try {
      sessionIdRef.current = `voice:${Date.now()}`;
      handledToolCallsRef.current.clear();
      if (Platform.OS !== "web") {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          shouldRouteThroughEarpiece: false,
          interruptionMode: "doNotMix",
        });
        setAudioRoute("speaker");
      }
      const token = await getRealtimeToken();
      connectionRef.current = await connectRealtime(
        token,
        handleEvent,
        () => setState("listening"),
        () => {
          setError("The realtime data channel failed");
          setState("error");
        },
      );
    } catch (cause) {
      stop();
      const message = cause instanceof Error ? cause.message : "Could not start voice mode";
      setError(message);
      setState("error");
      if (message.toLowerCase().includes("unauthorized")) onUnauthorized();
    }
  };

  const toggleMute = () => {
    const next = !muted;
    connectionRef.current?.setMuted(next);
    setMuted(next);
  };

  const toggleAudioRoute = async () => {
    const next = audioRoute === "speaker" ? "earpiece" : "speaker";
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      shouldRouteThroughEarpiece: next === "earpiece",
      interruptionMode: "doNotMix",
    });
    setAudioRoute(next);
  };

  const active = state !== "idle" && state !== "error";
  return (
    <View style={styles.root}>
      <Text style={styles.eyebrow}>OPENAI REALTIME MINI</Text>
      <Text style={styles.title}>Live voice</Text>
      <Text style={styles.subtitle}>
        Fluid conversation backed by Vito memory, durable tasks, and saved transcripts.
      </Text>

      <View
        style={[styles.orb, active && styles.orbActive, state === "speaking" && styles.orbSpeaking]}
      >
        {state === "connecting" ? (
          <ActivityIndicator color="#11150d" size="large" />
        ) : (
          <Text style={styles.orbMark}>V</Text>
        )}
      </View>
      <Text style={styles.state}>
        {state === "idle"
          ? "Ready"
          : state === "connecting"
            ? "Connecting…"
            : state === "speaking"
              ? "Vito is speaking"
              : state === "listening"
                ? muted
                  ? "Muted"
                  : "Listening"
                : "Connection failed"}
      </Text>
      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.controls}>
        {active && (
          <>
            <Pressable onPress={toggleMute} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>{muted ? "Unmute" : "Mute"}</Text>
            </Pressable>
            {Platform.OS !== "web" && (
              <Pressable onPress={() => void toggleAudioRoute()} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>
                  {audioRoute === "speaker" ? "Earpiece" : "Speaker"}
                </Text>
              </Pressable>
            )}
          </>
        )}
        <Pressable
          onPress={active ? stop : () => void start()}
          style={[styles.primaryButton, active && styles.stopButton]}
        >
          <Text style={styles.primaryText}>{active ? "End session" : "Start voice"}</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent}>
        {!active && history.length > 0 && (
          <View style={styles.historyBlock}>
            <Text style={styles.historyTitle}>RECENT VOICE SESSIONS</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.historyRow}>
                {history.slice(0, 8).map((session) => (
                  <Pressable
                    key={session.id}
                    onPress={() => void openHistory(session.id)}
                    style={styles.historyCard}
                  >
                    <Text style={styles.historyDate}>
                      {new Date(session.created_at).toLocaleDateString()}
                    </Text>
                    <Text style={styles.historyTime}>
                      {new Date(session.created_at).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
        )}
        {sessionSummary && <Text style={styles.summary}>{sessionSummary}</Text>}
        {transcript.map((line) => (
          <View key={line.id} style={styles.line}>
            <Text style={styles.role}>{line.role}</Text>
            <Text style={styles.lineText}>{line.text}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center" },
  eyebrow: {
    alignSelf: "flex-start",
    color: "#a9e83a",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.8,
  },
  title: {
    alignSelf: "flex-start",
    color: "#f0f2ef",
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -1.2,
    marginTop: 5,
  },
  subtitle: {
    alignSelf: "flex-start",
    color: "#7f877f",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    maxWidth: 500,
  },
  orb: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: "#272d25",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 42,
    borderWidth: 1,
    borderColor: "#3b4338",
  },
  orbActive: { backgroundColor: "#b7f34a", borderColor: "#d2ff80" },
  orbSpeaking: {
    transform: [{ scale: 1.07 }],
    shadowColor: "#b7f34a",
    shadowOpacity: 0.4,
    shadowRadius: 28,
  },
  orbMark: { color: "#11150d", fontSize: 50, fontWeight: "900" },
  state: { color: "#d9ddd8", fontSize: 15, fontWeight: "700", marginTop: 20 },
  error: {
    color: "#ef827b",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 10,
    maxWidth: 340,
  },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    marginTop: 24,
  },
  primaryButton: {
    minWidth: 140,
    height: 50,
    borderRadius: 15,
    backgroundColor: "#b7f34a",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  stopButton: { backgroundColor: "#ed746c" },
  primaryText: { color: "#11150d", fontSize: 14, fontWeight: "800" },
  secondaryButton: {
    minWidth: 100,
    height: 50,
    borderRadius: 15,
    backgroundColor: "#202420",
    borderWidth: 1,
    borderColor: "#343a34",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: "#d8ddd7", fontSize: 14, fontWeight: "700" },
  transcript: { width: "100%", marginTop: 30, borderTopWidth: 1, borderTopColor: "#252a25" },
  transcriptContent: { paddingVertical: 16, gap: 13 },
  historyBlock: { gap: 10, marginBottom: 4 },
  historyTitle: { color: "#727a72", fontSize: 9, fontWeight: "800", letterSpacing: 1.2 },
  historyRow: { flexDirection: "row", gap: 9 },
  historyCard: {
    minWidth: 112,
    backgroundColor: "#151915",
    borderColor: "#2b312b",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  historyDate: { color: "#d7dbd6", fontSize: 12, fontWeight: "700" },
  historyTime: { color: "#7f877f", fontSize: 11, marginTop: 3 },
  summary: { color: "#97a096", fontSize: 11, textAlign: "center" },
  line: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#121512",
    borderWidth: 1,
    borderColor: "#252a25",
  },
  role: {
    color: "#9aca4d",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: 5,
    textTransform: "uppercase",
  },
  lineText: { color: "#d7dbd6", fontSize: 14, lineHeight: 20 },
});
