import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform } from "react-native";
import {
  getGeminiRealtimeBootstrap,
  getRealtimeToken,
  getVoiceAvailability,
  getVoiceContext,
  getVoiceConversationContext,
  getVoiceTask,
  loadGeminiLiveVoice,
  loadLiveVoiceProvider,
  loadRealtimeModel,
  loadRealtimeVoice,
  persistVoiceEvent,
  searchVoiceMemory,
  startVoiceTask,
  type GeminiLiveVoice,
  type LiveVoiceProviderPreference,
  type RealtimeModel,
  type RealtimeVoice,
  type VoiceAvailability,
} from "../services/api/client";
import {
  setVoiceAudioRoute,
  startVoiceAudio,
  stopVoiceAudio,
  type VoiceAudioRoute,
} from "../services/voice/audio-routing";
import { geminiLiveVoiceProvider } from "../services/voice/gemini-live-voice";
import type { LiveVoiceEvent, LiveVoiceSession } from "../services/voice/live-voice";
import { openAiLiveVoiceProvider } from "../services/voice/openai-live-voice";
import { hasDeliverableVoiceTaskResult } from "../services/voice/voice-task-state";
import { useAgentName } from "./agentIdentity";

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

export interface VoiceTranscriptLine {
  id: number;
  role: "user" | "agent";
  text: string;
}

export interface VisibleVoiceTask {
  id: string;
  question: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";
  result: string | null;
}

interface PendingTaskAnnouncement {
  id: string;
  status: "completed" | "failed";
}

interface VoiceSessionContextValue {
  state: VoiceState;
  active: boolean;
  available: boolean | null;
  error: string | null;
  transcript: VoiceTranscriptLine[];
  tasks: VisibleVoiceTask[];
  status: VoiceOverlayStatus;
  controls: VoiceOverlayControls | null;
  chatSessionId: string | null;
  refreshConfiguration(): Promise<void>;
  start(options: { chatSessionId: string }): Promise<void>;
  stop(): void;
}

const TASK_ANNOUNCEMENT_IDLE_MS = 2_500;
const VoiceSessionContext = createContext<VoiceSessionContextValue | null>(null);

export function VoiceSessionProvider({
  children,
  onUnauthorized,
}: {
  children: ReactNode;
  onUnauthorized: () => void;
}) {
  const agentName = useAgentName();
  const [state, setState] = useState<VoiceState>("idle");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [availability, setAvailability] = useState<VoiceAvailability | null>(null);
  const [muted, setMuted] = useState(false);
  const [audioRoute, setAudioRouteState] = useState<VoiceAudioRoute>("speaker");
  const [selectedVoice, setSelectedVoice] = useState<RealtimeVoice>("marin");
  const [selectedModel, setSelectedModel] = useState<RealtimeModel>("gpt-realtime-mini");
  const [providerPreference, setProviderPreference] = useState<LiveVoiceProviderPreference>("auto");
  const [geminiVoice, setGeminiVoice] = useState<GeminiLiveVoice>("Kore");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<VoiceTranscriptLine[]>([]);
  const [tasks, setTasks] = useState<VisibleVoiceTask[]>([]);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);

  const connectionRef = useRef<LiveVoiceSession | null>(null);
  const sessionGenerationRef = useRef(0);
  const lineIdRef = useRef(0);
  const sessionIdRef = useRef(`voice:${Date.now()}`);
  const parentSessionIdRef = useRef<string | null>(null);
  const persistenceChainRef = useRef<Promise<void>>(Promise.resolve());
  const sessionStartedAtRef = useRef<number | null>(null);
  const handledToolCallsRef = useRef(new Set<string>());
  const pendingTaskAnnouncementsRef = useRef<PendingTaskAnnouncement[]>([]);
  const announcedTaskIdsRef = useRef(new Set<string>());
  const announcementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechActivityRef = useRef({ user: false, assistant: false, lastChangedAt: Date.now() });
  const attemptTaskAnnouncementRef = useRef<() => void>(() => undefined);

  const refreshConfiguration = useCallback(async () => {
    const [voiceAvailability, realtimeVoice, realtimeModel, liveProvider, selectedGeminiVoice] =
      await Promise.all([
        getVoiceAvailability().catch(() => null),
        loadRealtimeVoice(),
        loadRealtimeModel(),
        loadLiveVoiceProvider(),
        loadGeminiLiveVoice(),
      ]);
    if (voiceAvailability) {
      setAvailability(voiceAvailability);
      setAvailable(voiceAvailability.available);
    } else {
      // Older backends do not expose availability; preserve the existing start behavior.
      setAvailable(null);
    }
    setSelectedVoice(realtimeVoice);
    setSelectedModel(realtimeModel);
    setProviderPreference(liveProvider);
    setGeminiVoice(selectedGeminiVoice);
  }, []);

  useEffect(() => {
    void refreshConfiguration();
  }, [refreshConfiguration]);

  const persistCurrentEvent = useCallback(
    (kind: "user" | "assistant" | "usage" | "session_end", content: string) => {
      const sessionId = sessionIdRef.current;
      const parentSessionId = parentSessionIdRef.current;
      if (!parentSessionId) return Promise.resolve();
      persistenceChainRef.current = persistenceChainRef.current
        .catch(() => undefined)
        .then(() => persistVoiceEvent(sessionId, parentSessionId, kind, content));
      return persistenceChainRef.current;
    },
    [],
  );

  const addLine = useCallback(
    (role: "user" | "agent", text: string) => {
      const clean = text.trim();
      if (!clean) return;
      setTranscript((current) => [...current, { id: ++lineIdRef.current, role, text: clean }]);
      void persistCurrentEvent(role === "user" ? "user" : "assistant", clean).catch(
        () => undefined,
      );
    },
    [persistCurrentEvent],
  );

  const clearAnnouncementState = useCallback(() => {
    if (announcementTimerRef.current) clearTimeout(announcementTimerRef.current);
    announcementTimerRef.current = null;
    pendingTaskAnnouncementsRef.current = [];
    speechActivityRef.current = { user: false, assistant: false, lastChangedAt: Date.now() };
  }, []);

  const closeConnection = useCallback(
    (persistEnd: boolean) => {
      if (persistEnd && sessionStartedAtRef.current !== null) {
        void persistCurrentEvent(
          "session_end",
          JSON.stringify({ durationMs: Math.max(0, Date.now() - sessionStartedAtRef.current) }),
        ).catch(() => undefined);
      }
      sessionStartedAtRef.current = null;
      sessionGenerationRef.current += 1;
      connectionRef.current?.close();
      connectionRef.current = null;
      clearAnnouncementState();
      if (Platform.OS !== "web") stopVoiceAudio();
    },
    [clearAnnouncementState, persistCurrentEvent],
  );

  const stop = useCallback(() => {
    closeConnection(true);
    setMuted(false);
    setState("idle");
  }, [closeConnection]);

  useEffect(() => () => closeConnection(false), [closeConnection]);

  const attemptTaskAnnouncement = useCallback(() => {
    if (
      announcementTimerRef.current ||
      !connectionRef.current ||
      pendingTaskAnnouncementsRef.current.length === 0
    )
      return;

    const elapsed = Date.now() - speechActivityRef.current.lastChangedAt;
    const delay = Math.max(250, TASK_ANNOUNCEMENT_IDLE_MS - elapsed);
    announcementTimerRef.current = setTimeout(() => {
      announcementTimerRef.current = null;
      const connection = connectionRef.current;
      const activity = speechActivityRef.current;
      if (!connection || pendingTaskAnnouncementsRef.current.length === 0) return;
      if (activity.user || activity.assistant) {
        attemptTaskAnnouncementRef.current();
        return;
      }

      const announcement = pendingTaskAnnouncementsRef.current.shift();
      if (!announcement || announcedTaskIdsRef.current.has(announcement.id)) {
        attemptTaskAnnouncementRef.current();
        return;
      }
      announcedTaskIdsRef.current.add(announcement.id);
      speechActivityRef.current = {
        ...speechActivityRef.current,
        assistant: true,
        lastChangedAt: Date.now(),
      };
      connection.requestResponse(
        announcement.status === "completed"
          ? `A background task finished after a brief delay. Check task ${announcement.id} in your trusted context and, at this quiet opening, proactively say "By the way" and summarize its useful result. Do not call a tool, repeat the request, or give a long preamble.`
          : `A background task ${announcement.id} failed after a brief delay. At this quiet opening, proactively tell the user it could not be completed. Do not call a tool or invent a result.`,
      );
    }, delay);
  }, []);

  useEffect(() => {
    attemptTaskAnnouncementRef.current = attemptTaskAnnouncement;
  }, [attemptTaskAnnouncement]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && connectionRef.current) {
        speechActivityRef.current.lastChangedAt = Date.now();
        attemptTaskAnnouncementRef.current();
      }
    });
    return () => subscription.remove();
  }, []);

  const queueTaskAnnouncement = useCallback((announcement: PendingTaskAnnouncement) => {
    if (
      announcedTaskIdsRef.current.has(announcement.id) ||
      pendingTaskAnnouncementsRef.current.some((pending) => pending.id === announcement.id)
    )
      return;
    pendingTaskAnnouncementsRef.current.push(announcement);
    attemptTaskAnnouncementRef.current();
  }, []);

  const markTaskHandled = useCallback((id: string) => {
    announcedTaskIdsRef.current.add(id);
    pendingTaskAnnouncementsRef.current = pendingTaskAnnouncementsRef.current.filter(
      (pending) => pending.id !== id,
    );
  }, []);

  const waitForTask = useCallback(
    async (id: string, generation = sessionGenerationRef.current) => {
      for (let attempt = 0; attempt < 300; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        if (generation !== sessionGenerationRef.current) return;
        const task = await getVoiceTask(id);
        if (generation !== sessionGenerationRef.current) return;
        if (!task) continue;
        setTasks((current) =>
          current.map((item) =>
            item.id === id ? { ...item, status: task.status, result: task.result } : item,
          ),
        );
        if (task.status === "queued" || task.status === "running") continue;
        if (connectionRef.current) {
          connectionRef.current.addHistory([
            {
              role: "system",
              text: `Trusted background task ${id} is now ${task.status}. Result: ${task.result ?? task.error ?? "No result"}. Keep this result available; the app will separately prompt you to announce it at a quiet opening.`,
            },
          ]);
          if (hasDeliverableVoiceTaskResult(task.status)) {
            queueTaskAnnouncement({ id, status: task.status });
          }
        }
        return;
      }
      setTasks((current) =>
        current.map((item) => (item.id === id ? { ...item, status: "timed_out" } : item)),
      );
    },
    [queueTaskAnnouncement],
  );

  const sendToolResult = useCallback((callId: string, result: unknown, instructions?: string) => {
    connectionRef.current?.submitToolResult(callId, result, instructions);
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
            message: `${agentName} is investigating in the background. Conversation can continue.`,
          };
          responseInstructions = `Briefly confirm the ${agentName} task is underway and conversation can continue. Do not claim you lack access, ask the user to reconstruct the answer, repeat the request, or imply the task failed.`;
        } else if (name === "get_vito_task") {
          const taskId = String(args.id ?? "");
          const task = await getVoiceTask(taskId);
          if (task && hasDeliverableVoiceTaskResult(task.status)) markTaskHandled(taskId);
          result = task;
        } else throw new Error(`Unknown tool: ${name}`);
        void persistCurrentEvent(
          "usage",
          JSON.stringify({ tool_success: { name, arguments: args } }),
        ).catch(() => undefined);
        sendToolResult(callId, result, responseInstructions);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Voice tool failed";
        addLine("agent", `Tool ${name} failed: ${message}`);
        void persistCurrentEvent("usage", JSON.stringify({ tool_error: { name, message } })).catch(
          () => undefined,
        );
        sendToolResult(callId, { error: message });
      }
    },
    [addLine, agentName, markTaskHandled, persistCurrentEvent, sendToolResult, waitForTask],
  );

  const handleEvent = useCallback(
    (event: LiveVoiceEvent) => {
      if (event.type === "listening") setState("listening");
      if (event.type === "speaking") setState("speaking");
      if (event.type === "speech_activity") {
        speechActivityRef.current = {
          ...speechActivityRef.current,
          [event.role === "user" ? "user" : "assistant"]: event.active,
          lastChangedAt: Date.now(),
        };
        if (!event.active) attemptTaskAnnouncementRef.current();
      }
      if (event.type === "transcript") {
        speechActivityRef.current.lastChangedAt = Date.now();
        addLine(event.role === "user" ? "user" : "agent", event.text);
      }
      if (event.type === "usage") {
        void persistCurrentEvent("usage", JSON.stringify(event.usage)).catch(() => undefined);
      }
      if (event.type === "tool_call") void executeTool(event.name, event.callId, event.arguments);
      if (event.type === "error") {
        setError(event.message);
        setState("error");
      }
    },
    [addLine, executeTool, persistCurrentEvent],
  );

  const start = useCallback(
    async ({ chatSessionId: nextChatSessionId }: { chatSessionId: string }) => {
      if (connectionRef.current || state === "connecting") return;
      setState("connecting");
      setError(null);
      setTranscript([]);
      setTasks([]);
      setChatSessionId(nextChatSessionId);
      parentSessionIdRef.current = nextChatSessionId;
      persistenceChainRef.current = Promise.resolve();
      try {
        sessionIdRef.current = `voice:${Date.now()}`;
        sessionStartedAtRef.current = Date.now();
        sessionGenerationRef.current += 1;
        handledToolCallsRef.current.clear();
        pendingTaskAnnouncementsRef.current = [];
        announcedTaskIdsRef.current.clear();
        clearAnnouncementState();
        const conversationTurns = await getVoiceConversationContext(nextChatSessionId);
        if (Platform.OS !== "web") {
          await startVoiceAudio("speaker");
          setAudioRouteState("speaker");
        }
        const provider =
          providerPreference === "auto" ? (availability?.provider ?? "openai") : providerPreference;
        if (availability && !availability.providers[provider]) {
          throw new Error(
            provider === "gemini"
              ? "Google AI API key is not configured"
              : "OpenAI API key is not configured",
          );
        }
        const bootstrap =
          provider === "gemini"
            ? await getGeminiRealtimeBootstrap(geminiVoice)
            : { value: await getRealtimeToken(selectedVoice, selectedModel) };
        const liveProvider =
          provider === "gemini" ? geminiLiveVoiceProvider : openAiLiveVoiceProvider;
        let opened = false;
        let hydrated = false;
        const hydrate = () => {
          if (!connectionRef.current || hydrated) return;
          hydrated = true;
          connectionRef.current.addHistory([
            {
              role: "system",
              text: "This is a continuation of the following conversation. Continue naturally from it. The conversation contains only prior user and assistant messages.",
            },
            ...conversationTurns,
          ]);
        };
        const connection = await liveProvider.connect({
          credential: bootstrap.value,
          metadata: provider === "gemini" ? bootstrap : undefined,
          onEvent: handleEvent,
          onOpen: () => {
            opened = true;
            setState("listening");
            queueMicrotask(hydrate);
          },
          onError: (message) => {
            closeConnection(sessionStartedAtRef.current !== null);
            setError(message);
            setState("error");
          },
        });
        connectionRef.current = connection;
        if (Platform.OS !== "web") await setVoiceAudioRoute("speaker");
        if (opened) hydrate();
      } catch (cause) {
        closeConnection(false);
        const message = cause instanceof Error ? cause.message : "Could not start voice mode";
        setError(message);
        setState("error");
        if (message.toLowerCase().includes("unauthorized")) onUnauthorized();
      }
    },
    [
      availability,
      clearAnnouncementState,
      closeConnection,
      geminiVoice,
      handleEvent,
      onUnauthorized,
      providerPreference,
      selectedModel,
      selectedVoice,
      state,
    ],
  );

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      connectionRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const toggleAudioRoute = useCallback(async () => {
    if (!connectionRef.current) return;
    const next = audioRoute === "speaker" ? "earpiece" : "speaker";
    try {
      await setVoiceAudioRoute(next);
      setAudioRouteState(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the audio route");
    }
  }, [audioRoute]);

  const active = state !== "idle" && state !== "error";
  const status = useMemo<VoiceOverlayStatus>(
    () => ({
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
    }),
    [audioRoute, muted, state, tasks],
  );
  const controls = useMemo<VoiceOverlayControls | null>(
    () =>
      active
        ? {
            toggleMute,
            toggleAudioRoute: () => void toggleAudioRoute(),
            hangUp: stop,
          }
        : null,
    [active, stop, toggleAudioRoute, toggleMute],
  );

  const value = useMemo<VoiceSessionContextValue>(
    () => ({
      state,
      active,
      available,
      error,
      transcript,
      tasks,
      status,
      controls,
      chatSessionId,
      refreshConfiguration,
      start,
      stop,
    }),
    [
      active,
      available,
      chatSessionId,
      controls,
      error,
      refreshConfiguration,
      start,
      state,
      status,
      stop,
      tasks,
      transcript,
    ],
  );

  return <VoiceSessionContext.Provider value={value}>{children}</VoiceSessionContext.Provider>;
}

export function useVoiceSession(): VoiceSessionContextValue {
  const value = useContext(VoiceSessionContext);
  if (!value) throw new Error("useVoiceSession must be used within VoiceSessionProvider");
  return value;
}
