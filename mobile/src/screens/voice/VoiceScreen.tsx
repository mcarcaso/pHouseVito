import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { StyleSheet } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import {
  getRealtimeToken,
  getVoiceAvailability,
  getVoiceContext,
  getVoiceSession,
  getVoiceSessions,
  getVoiceTask,
  loadRealtimeModel,
  loadRealtimeVoice,
  persistVoiceEvent,
  saveRealtimeModel,
  searchVoiceMemory,
  startVoiceTask,
  type RealtimeModel,
  type RealtimeVoice,
  type VoiceSession,
  type VoiceSessionDetail,
} from "../../services/api/client";
import { useAgentName } from "../../contexts/agentIdentity";
import type { LiveVoiceEvent, LiveVoiceSession } from "../../services/voice/live-voice";
import { openAiLiveVoiceProvider } from "../../services/voice/openai-live-voice";
import {
  setVoiceAudioRoute,
  startVoiceAudio,
  stopVoiceAudio,
  type VoiceAudioRoute,
} from "../../services/voice/audio-routing";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";
import { VoiceControlBar } from "../../components/voice/GlobalVoiceOverlay";

export type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "error";
export interface VoiceOverlayStatus {
  state: VoiceState;
  muted: boolean;
  audioRoute: VoiceAudioRoute;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
}
export interface VoiceOverlayControls {
  toggleMute: () => void;
  toggleAudioRoute: () => void;
  hangUp: () => void;
}

interface TranscriptLine {
  id: number;
  role: "user" | "agent";
  text: string;
}
interface VisibleTask {
  id: string;
  question: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";
  result: string | null;
}

export function VoiceScreen({
  onUnauthorized,
  onStatusChange,
  onControlsChange,
  onConfigureOpenAi,
}: {
  onUnauthorized: () => void;
  onStatusChange?: (status: VoiceOverlayStatus) => void;
  onControlsChange?: (controls: VoiceOverlayControls | null) => void;
  onConfigureOpenAi?: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const agentName = useAgentName();
  const [state, setState] = useState<VoiceState>("idle");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [muted, setMuted] = useState(false);
  const [audioRoute, setAudioRoute] = useState<VoiceAudioRoute>("speaker");
  const [selectedVoice, setSelectedVoice] = useState<RealtimeVoice>("marin");
  const [selectedModel, setSelectedModel] = useState<RealtimeModel>("gpt-realtime-mini");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [history, setHistory] = useState<VoiceSession[]>([]);
  const [sessionSummary, setSessionSummary] = useState<string | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<VoiceSessionDetail | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [tasks, setTasks] = useState<VisibleTask[]>([]);
  const connectionRef = useRef<LiveVoiceSession | null>(null);
  const lineIdRef = useRef(0);
  const sessionIdRef = useRef(`voice:${Date.now()}`);
  const handledToolCallsRef = useRef(new Set<string>());

  useFocusEffect(
    useCallback(() => {
      let current = true;
      void getVoiceAvailability()
        .then((status) => {
          if (current) setAvailable(status.available);
        })
        .catch(() => {
          // Older backends do not expose availability; preserve the existing start behavior.
          if (current) setAvailable(null);
        });
      return () => {
        current = false;
      };
    }, []),
  );

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
    void loadRealtimeModel().then(setSelectedModel);
  }, [loadHistory]);

  useEffect(() => {
    onStatusChange?.({
      state,
      muted,
      audioRoute,
      runningTasks: tasks.filter((task) => task.status === "queued" || task.status === "running")
        .length,
      completedTasks: tasks.filter((task) => task.status === "completed").length,
      failedTasks: tasks.filter(
        (task) =>
          task.status === "failed" || task.status === "cancelled" || task.status === "timed_out",
      ).length,
    });
  }, [audioRoute, muted, onStatusChange, state, tasks]);

  const openHistory = useCallback(async (id: string) => {
    const detail = await getVoiceSession(id);
    if (!detail) return;
    setSelectedHistory(detail);
    setTranscript(
      detail.messages
        .filter((message) => message.type === "user" || message.type === "assistant")
        .map((message) => ({
          id: ++lineIdRef.current,
          role: message.type === "user" ? ("user" as const) : ("agent" as const),
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

  const addLine = useCallback((role: "user" | "agent", text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setTranscript((current) => [...current, { id: ++lineIdRef.current, role, text: clean }]);
    void persistVoiceEvent(
      sessionIdRef.current,
      role === "user" ? "user" : "assistant",
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
    if (Platform.OS !== "web") stopVoiceAudio();
    setMuted(false);
    setState("idle");
    void loadHistory();
  }, [loadHistory]);

  const sendToolResult = useCallback((callId: string, result: unknown, instructions?: string) => {
    connectionRef.current?.submitToolResult(callId, result, instructions);
  }, []);

  const waitForTask = useCallback(
    async (id: string) => {
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
        connectionRef.current?.addHistory([
          {
            role: "system",
            text: `Background ${agentName} task ${id} is now ${task.status}. Result: ${task.result ?? task.error ?? "No result"}. Do not speak about this until the user asks about the task or its result.`,
          },
        ]);
        return;
      }
      setTasks((current) =>
        current.map((item) => (item.id === id ? { ...item, status: "timed_out" } : item)),
      );
    },
    [agentName],
  );

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
            message: `${agentName} is investigating in the background. Conversation can continue.`,
          };
          responseInstructions = `Briefly confirm the ${agentName} task is underway and conversation can continue. Do not claim you lack access, ask the user to reconstruct the answer, repeat the request, or imply the task failed.`;
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
        addLine("agent", `Tool ${name} failed: ${message}`);
        void persistVoiceEvent(
          sessionIdRef.current,
          "usage",
          JSON.stringify({ tool_error: { name, message } }),
        ).catch(() => undefined);
        sendToolResult(callId, { error: message });
      }
    },
    [addLine, agentName, sendToolResult, waitForTask],
  );

  const handleEvent = useCallback(
    (event: LiveVoiceEvent) => {
      if (event.type === "listening") setState("listening");
      if (event.type === "speaking") setState("speaking");
      if (event.type === "transcript")
        addLine(event.role === "user" ? "user" : "agent", event.text);
      if (event.type === "usage") {
        void persistVoiceEvent(sessionIdRef.current, "usage", JSON.stringify(event.usage)).catch(
          () => undefined,
        );
      }
      if (event.type === "tool_call") {
        void executeTool(event.name, event.callId, event.arguments);
      }
      if (event.type === "error") {
        setError(event.message);
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
        await startVoiceAudio("speaker");
        setAudioRoute("speaker");
      }
      const token = await getRealtimeToken(selectedVoice, selectedModel);
      let opened = false;
      let hydrated = false;
      const hydrate = () => {
        if (!resume || !connectionRef.current || hydrated) return;
        hydrated = true;
        const turns = resume.messages
          .filter((message) => message.type === "user" || message.type === "assistant")
          .slice(-30);
        connectionRef.current.addHistory([
          ...turns.map((message) => ({
            role: message.type === "user" ? ("user" as const) : ("assistant" as const),
            text: message.content,
          })),
          ...((resume.tasks ?? []).length > 0
            ? [
                {
                  role: "system" as const,
                  text: `This is a resumed ${agentName} voice conversation. Prior background tasks: ${JSON.stringify(
                    (resume.tasks ?? []).map((task) => ({
                      id: task.id,
                      question: task.question,
                      status: task.status,
                      result: task.result,
                      error: task.error,
                    })),
                  )}. Use completed results when the user asks about them; do not announce them unsolicited.`,
                },
              ]
            : []),
        ]);
      };
      const connection = await openAiLiveVoiceProvider.connect({
        credential: token,
        onEvent: handleEvent,
        onOpen: () => {
          opened = true;
          setState("listening");
          queueMicrotask(hydrate);
        },
        onError: (message) => {
          setError(message);
          setState("error");
        },
      });
      connectionRef.current = connection;
      if (Platform.OS !== "web") await setVoiceAudioRoute("speaker");
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
    if (!connectionRef.current || state === "connecting") return;
    const next = audioRoute === "speaker" ? "earpiece" : "speaker";
    try {
      await setVoiceAudioRoute(next);
      setAudioRoute(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the audio route");
    }
  };

  const active = state !== "idle" && state !== "error";
  useEffect(() => {
    onControlsChange?.(
      active
        ? {
            toggleMute,
            toggleAudioRoute: () => void toggleAudioRoute(),
            hangUp: stop,
          }
        : null,
    );
    return () => onControlsChange?.(null);
  }, [active, audioRoute, muted, onControlsChange, stop, state]);

  const controlStatus: VoiceOverlayStatus = {
    state,
    muted,
    audioRoute,
    runningTasks: tasks.filter((task) => task.status === "queued" || task.status === "running")
      .length,
    completedTasks: tasks.filter((task) => task.status === "completed").length,
    failedTasks: tasks.filter(
      (task) =>
        task.status === "failed" || task.status === "cancelled" || task.status === "timed_out",
    ).length,
  };
  const localControls: VoiceOverlayControls | null = active
    ? { toggleMute, toggleAudioRoute: () => void toggleAudioRoute(), hangUp: stop }
    : null;

  return (
    <View style={styles.root}>
      {error && <Text style={styles.error}>{error}</Text>}
      {!active && available === false && !selectedHistory && (
        <View style={styles.unavailable}>
          <Ionicons name="mic-off-outline" size={34} color={theme.colors.textMuted} />
          <Text style={styles.unavailableTitle}>Live Voice is unavailable</Text>
          <Text style={styles.unavailableText}>
            Live conversations use OpenAI Realtime and require an OpenAI API key.
          </Text>
          {onConfigureOpenAi && (
            <Pressable onPress={onConfigureOpenAi} style={styles.configureButton}>
              <Text style={styles.configureButtonText}>Configure OpenAI</Text>
            </Pressable>
          )}
        </View>
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

      {selectedHistory && !active && (
        <Pressable onPress={() => void start(selectedHistory)} style={styles.resumeButton}>
          <Text style={styles.resumeButtonText}>Resume conversation</Text>
        </Pressable>
      )}
      {!active && available !== false && !selectedHistory && !showHistory && (
        <View style={styles.modelPicker}>
          <Text style={styles.modelPickerLabel}>VOICE MODEL</Text>
          <View style={styles.modelOptions}>
            {(
              [
                ["gpt-realtime-mini", "Fast"],
                ["gpt-realtime", "Full"],
              ] as const
            ).map(([model, label]) => (
              <Pressable
                key={model}
                onPress={() => {
                  setSelectedModel(model);
                  void saveRealtimeModel(model);
                }}
                style={[styles.modelOption, selectedModel === model && styles.modelOptionSelected]}
              >
                <Text
                  style={[
                    styles.modelOptionText,
                    selectedModel === model && styles.modelOptionTextSelected,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent}>
        {available !== false && !showHistory && !selectedHistory && transcript.length === 0 && (
          <View style={styles.transcriptEmpty}>
            <Ionicons name="chatbubbles-outline" size={32} color={theme.colors.textMuted} />
            <Text style={styles.transcriptEmptyTitle}>Your transcript will appear here</Text>
            <Text style={styles.transcriptEmptyText}>
              Start a conversation to see what you and {agentName} say.
            </Text>
          </View>
        )}
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
            <Text style={styles.role}>{line.role === "user" ? "You" : agentName}</Text>
            <Text style={styles.lineText}>{line.text}</Text>
          </View>
        ))}
      </ScrollView>
      {available !== false && !selectedHistory && !showHistory && (
        <View style={styles.embeddedControls}>
          <VoiceControlBar
            status={controlStatus}
            controls={localControls}
            onStart={() => void start(null)}
          />
        </View>
      )}
    </View>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    root: { flex: 1, width: "100%", alignItems: "center" },
    modelPicker: {
      width: "100%",
      maxWidth: 760,
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.md,
    },
    modelPickerLabel: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 0.8,
      marginBottom: theme.space.sm,
    },
    modelOptions: { flexDirection: "row", gap: theme.space.sm },
    modelOption: {
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      borderRadius: 10,
      paddingHorizontal: theme.space.lg,
      paddingVertical: theme.space.sm,
    },
    modelOptionSelected: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    modelOptionText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: "700" },
    modelOptionTextSelected: { color: theme.colors.accentText },
    unavailable: {
      width: "100%",
      maxWidth: 420,
      alignItems: "center",
      paddingHorizontal: theme.space.xl,
      paddingVertical: theme.space.xxxl,
    },
    unavailableTitle: {
      color: theme.colors.text,
      fontSize: 17,
      fontWeight: "800",
      marginTop: theme.space.md,
    },
    unavailableText: {
      color: theme.colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
      textAlign: "center",
      marginTop: theme.space.sm,
    },
    configureButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: 12,
      paddingHorizontal: theme.space.xl,
      paddingVertical: theme.space.md,
      marginTop: theme.space.xl,
    },
    configureButtonText: { color: theme.colors.accentText, fontSize: 13, fontWeight: "800" },
    error: {
      color: theme.colors.danger,
      fontSize: 12,
      lineHeight: 17,
      textAlign: "center",
      marginTop: theme.space.md,
      maxWidth: 340,
    },
    voiceStage: { flex: 1, minHeight: 390, alignItems: "center", justifyContent: "center" },
    orb: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: theme.colors.surfaceRaised,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
    },
    orbActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
    orbSpeaking: { opacity: 0.9 },
    orbConnecting: { opacity: 0.8 },
    state: {
      color: theme.colors.textSecondary,
      fontSize: 15,
      fontWeight: "700",
      marginTop: theme.space.md,
    },
    controls: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      gap: theme.space.md,
      marginTop: theme.space.xxl,
    },
    secondaryButton: {
      minWidth: 100,
      height: 50,
      borderRadius: 15,
      backgroundColor: theme.colors.surfaceRaised,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryText: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: "700" },
    historyButton: {
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.space.xl,
      marginBottom: theme.space.md,
    },
    historyButtonText: { color: theme.colors.accent, fontSize: 13, fontWeight: "800" },
    taskStack: { width: "100%", gap: theme.space.sm, marginTop: theme.space.lg },
    taskCard: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      borderRadius: 13,
      padding: theme.space.md,
    },
    taskHeader: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
    taskIcon: { fontSize: 14 },
    taskStatus: { color: theme.colors.text, fontSize: 12, fontWeight: "800" },
    taskQuestion: { color: theme.colors.textMuted, fontSize: 11, marginTop: theme.space.sm },
    taskHint: {
      color: theme.colors.accent,
      fontSize: 11,
      fontWeight: "700",
      marginTop: theme.space.sm,
    },
    resumeButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: 12,
      paddingHorizontal: theme.space.xl,
      paddingVertical: theme.space.md,
      marginTop: theme.space.lg,
    },
    resumeButtonText: { color: theme.colors.accentText, fontSize: 13, fontWeight: "800" },
    transcript: { flex: 1, width: "100%" },
    transcriptContent: { flexGrow: 1, paddingVertical: theme.space.lg, gap: theme.space.md },
    transcriptEmpty: {
      flex: 1,
      minHeight: 320,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.space.xxl,
    },
    transcriptEmptyTitle: {
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "800",
      marginTop: theme.space.md,
    },
    transcriptEmptyText: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 18,
      textAlign: "center",
      marginTop: theme.space.sm,
    },
    embeddedControls: { width: "100%", paddingTop: theme.space.sm },
    historyBlock: { gap: theme.space.md, marginBottom: theme.space.xs },
    historyTitle: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 1.2,
    },
    historyListRow: {
      minHeight: 62,
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
      paddingVertical: theme.space.md,
    },
    historyListCopy: { flex: 1, minWidth: 0 },
    historyListTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "700" },
    historyTime: { color: theme.colors.textMuted, fontSize: 11, marginTop: theme.space.xs },
    historyChevron: { color: theme.colors.textMuted, fontSize: 24 },
    summary: { color: theme.colors.textSecondary, fontSize: 11, textAlign: "center" },
    line: {
      padding: theme.space.lg,
      borderRadius: 14,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separator,
    },
    role: {
      color: theme.colors.accent,
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 1.2,
      marginBottom: theme.space.xs,
      textTransform: "uppercase",
    },
    lineText: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20 },
  });
