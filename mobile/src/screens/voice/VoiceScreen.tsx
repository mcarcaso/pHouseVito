import { useCallback, useEffect, useRef, useState } from "react";
import { setAudioModeAsync } from "expo-audio";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import {
  getRealtimeToken,
  getVoiceContext,
  getVoiceSession,
  getVoiceSessions,
  getVoiceTask,
  loadRealtimeVoice,
  persistVoiceEvent,
  searchVoiceMemory,
  startVoiceTask,
  type RealtimeVoice,
  type VoiceSession,
  type VoiceSessionDetail,
} from "../../services/api/client";
import { connectRealtime, type VoiceConnection } from "../../services/voice/realtime-webrtc";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";
import { createVoiceStyles } from "./styles";

export type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "error";
export interface VoiceOverlayStatus {
  state: VoiceState;
  muted: boolean;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
}

interface TranscriptLine {
  id: number;
  role: "Mike" | "Vito";
  text: string;
}
interface VisibleTask {
  id: string;
  question: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";
  result: string | null;
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

export function VoiceScreen({
  onUnauthorized,
  onStatusChange,
  onPastConversations,
}: {
  onUnauthorized: () => void;
  onStatusChange?: (status: VoiceOverlayStatus) => void;
  onPastConversations: () => void;
}) {
  const styles = useThemeStyles(createVoiceStyles);
  const theme = useVitoTheme();
  const [state, setState] = useState<VoiceState>("idle");
  const [muted, setMuted] = useState(false);
  const [audioRoute, setAudioRoute] = useState<"speaker" | "earpiece">("speaker");
  const [selectedVoice, setSelectedVoice] = useState<RealtimeVoice>("marin");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [history, setHistory] = useState<VoiceSession[]>([]);
  const [sessionSummary, setSessionSummary] = useState<string | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<VoiceSessionDetail | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [tasks, setTasks] = useState<VisibleTask[]>([]);
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
    void loadRealtimeVoice().then(setSelectedVoice);
  }, [loadHistory]);

  useEffect(() => {
    onStatusChange?.({
      state,
      muted,
      runningTasks: tasks.filter((task) => task.status === "queued" || task.status === "running")
        .length,
      completedTasks: tasks.filter((task) => task.status === "completed").length,
      failedTasks: tasks.filter(
        (task) =>
          task.status === "failed" || task.status === "cancelled" || task.status === "timed_out",
      ).length,
    });
  }, [muted, onStatusChange, state, tasks]);

  const openHistory = useCallback(async (id: string) => {
    const detail = await getVoiceSession(id);
    if (!detail) return;
    setSelectedHistory(detail);
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
    setTasks(
      (detail.tasks ?? []).map((task) => ({
        id: task.id,
        question: task.question,
        status: task.status,
        result: task.result,
      })),
    );
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

  const sendToolResult = useCallback((callId: string, result: unknown, instructions?: string) => {
    connectionRef.current?.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(result),
      },
    });
    connectionRef.current?.sendEvent({
      type: "response.create",
      response: {
        instructions:
          instructions ??
          "Use the tool result. If another tool is needed, call it silently without narrating the search. Otherwise answer Mike directly.",
      },
    });
  }, []);

  const waitForTask = useCallback(async (id: string) => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const task = await getVoiceTask(id);
      if (!task) continue;
      setTasks((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: task.status, result: task.result } : item,
        ),
      );
      if (task.status === "queued" || task.status === "running") continue;
      connectionRef.current?.sendEvent({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "system",
          content: [
            {
              type: "input_text",
              text: `Background Vito task ${id} is now ${task.status}. Result: ${task.result ?? task.error ?? "No result"}. Do not speak about this until Mike asks about the task or its result.`,
            },
          ],
        },
      });
      return;
    }
    setTasks((current) =>
      current.map((item) => (item.id === id ? { ...item, status: "timed_out" } : item)),
    );
  }, []);

  const executeTool = useCallback(
    async (name: string, callId: string, rawArguments?: string) => {
      if (handledToolCallsRef.current.has(callId)) return;
      handledToolCallsRef.current.add(callId);
      let args: Record<string, unknown> = {};
      try {
        args = rawArguments ? (JSON.parse(rawArguments) as Record<string, unknown>) : {};
        let result: unknown;
        let responseInstructions: string | undefined;
        if (name === "get_vito_context") result = await getVoiceContext();
        else if (name === "search_memory") {
          result = await searchVoiceMemory({
            query: String(args.query ?? ""),
            mode: args.mode === "semantic" || args.mode === "exact" ? args.mode : "hybrid",
            startDate: typeof args.startDate === "string" ? args.startDate : undefined,
            endDate: typeof args.endDate === "string" ? args.endDate : undefined,
            limit: typeof args.limit === "number" ? args.limit : undefined,
          });
        } else if (name === "create_vito_task") {
          const question = String(args.question ?? "");
          const task = await startVoiceTask(sessionIdRef.current, question);
          setTasks((current) => [
            ...current,
            { id: task.id, question, status: task.status, result: task.result },
          ]);
          void waitForTask(task.id);
          result = {
            taskId: task.id,
            status: task.status,
            message: "Vito is investigating in the background. Conversation can continue.",
          };
          responseInstructions =
            "Briefly confirm the Vito task is underway and conversation can continue. Do not claim you lack access, ask Mike to reconstruct the answer, repeat the request, or imply the task failed.";
        } else if (name === "get_vito_task") {
          result = await getVoiceTask(String(args.id ?? ""));
        } else throw new Error(`Unknown tool: ${name}`);
        void persistVoiceEvent(
          sessionIdRef.current,
          "usage",
          JSON.stringify({ tool_success: { name, arguments: args } }),
        ).catch(() => undefined);
        sendToolResult(callId, result, responseInstructions);
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

  const start = async (resume?: VoiceSessionDetail | null) => {
    if (state !== "idle" && state !== "error") return;
    setState("connecting");
    setError(null);
    if (!resume) {
      setTranscript([]);
      setTasks([]);
      setSessionSummary(null);
      setSelectedHistory(null);
    }
    try {
      sessionIdRef.current = resume?.session.id ?? `voice:${Date.now()}`;
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
      const token = await getRealtimeToken(selectedVoice);
      let opened = false;
      let hydrated = false;
      const hydrate = () => {
        if (!resume || !connectionRef.current || hydrated) return;
        hydrated = true;
        const turns = resume.messages
          .filter((message) => message.type === "user" || message.type === "assistant")
          .slice(-30);
        for (const message of turns) {
          connectionRef.current.sendEvent({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: message.type === "user" ? "user" : "assistant",
              content: [
                {
                  type: message.type === "user" ? "input_text" : "output_text",
                  text: message.content,
                },
              ],
            },
          });
        }
        if ((resume.tasks ?? []).length > 0) {
          connectionRef.current.sendEvent({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: `This is a resumed Vito voice conversation. Prior background tasks: ${JSON.stringify(
                    (resume.tasks ?? []).map((task) => ({
                      id: task.id,
                      question: task.question,
                      status: task.status,
                      result: task.result,
                      error: task.error,
                    })),
                  )}. Use completed results when Mike asks about them; do not announce them unsolicited.`,
                },
              ],
            },
          });
        }
      };
      const connection = await connectRealtime(
        token,
        handleEvent,
        () => {
          opened = true;
          setState("listening");
          queueMicrotask(hydrate);
        },
        () => {
          setError("The realtime data channel failed");
          setState("error");
        },
      );
      connectionRef.current = connection;
      if (opened) hydrate();
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
      {error && <Text style={styles.error}>{error}</Text>}
      {!selectedHistory && !showHistory && (
        <View style={styles.voiceStage}>
          <Pressable
            accessibilityLabel={active ? "End voice conversation" : "Start voice conversation"}
            onPress={active ? stop : () => void start(null)}
            style={[
              styles.orb,
              active && styles.orbActive,
              state === "speaking" && styles.orbSpeaking,
              state === "connecting" && styles.orbConnecting,
            ]}
          >
            {state === "connecting" ? (
              <ActivityIndicator color={theme.colors.accentText} size="large" />
            ) : (
              <Text style={[styles.orbMark, active && styles.orbMarkActive]}>
                {active ? "■" : "V"}
              </Text>
            )}
          </Pressable>
          <Text style={styles.state}>
            {active
              ? state === "speaking"
                ? "Speaking"
                : muted
                  ? "Muted"
                  : "Listening"
              : "Tap to start"}
          </Text>
          {active && (
            <View style={styles.controls}>
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
            </View>
          )}
        </View>
      )}
      {!active && !selectedHistory && (
        <Pressable onPress={onPastConversations} style={styles.historyButton}>
          <Text style={styles.historyButtonText}>Past conversations</Text>
        </Pressable>
      )}
      {!active && selectedHistory && (
        <Pressable
          onPress={() => {
            setSelectedHistory(null);
            setTranscript([]);
            setTasks([]);
            setSessionSummary(null);
            setShowHistory(true);
          }}
          style={styles.historyButton}
        >
          <Text style={styles.historyButtonText}>‹ Past conversations</Text>
        </Pressable>
      )}

      {tasks.length > 0 && (
        <View style={styles.taskStack}>
          {tasks.map((task) => (
            <View key={task.id} style={styles.taskCard}>
              <View style={styles.taskHeader}>
                <Text style={styles.taskIcon}>
                  {task.status === "completed"
                    ? "✅"
                    : task.status === "failed" ||
                        task.status === "cancelled" ||
                        task.status === "timed_out"
                      ? "⚠️"
                      : "⏳"}
                </Text>
                <Text style={styles.taskStatus}>
                  {task.status === "completed"
                    ? "Vito investigation complete"
                    : task.status === "running"
                      ? "Vito is investigating"
                      : task.status.replace("_", " ")}
                </Text>
              </View>
              <Text style={styles.taskQuestion} numberOfLines={2}>
                {task.question}
              </Text>
              {task.status === "completed" && (
                <Text style={styles.taskHint}>Say “Tell me the task result.”</Text>
              )}
            </View>
          ))}
        </View>
      )}

      {selectedHistory && !active && (
        <Pressable onPress={() => void start(selectedHistory)} style={styles.resumeButton}>
          <Text style={styles.resumeButtonText}>Resume conversation</Text>
        </Pressable>
      )}
      <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent}>
        {!active && showHistory && !selectedHistory && history.length > 0 && (
          <View style={styles.historyBlock}>
            <Text style={styles.historyTitle}>RECENT CONVERSATIONS</Text>
            {history.slice(0, 8).map((session) => (
              <Pressable
                key={session.id}
                onPress={() => void openHistory(session.id)}
                style={styles.historyListRow}
              >
                <View style={styles.historyListCopy}>
                  <Text style={styles.historyListTitle} numberOfLines={1}>
                    {session.alias?.startsWith("Voice —")
                      ? "Voice conversation"
                      : (session.alias ?? "Voice conversation")}
                  </Text>
                  <Text style={styles.historyTime}>
                    {new Date(session.created_at).toLocaleDateString()} ·{" "}
                    {new Date(session.created_at).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Text>
                </View>
                <Text style={styles.historyChevron}>›</Text>
              </Pressable>
            ))}
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
