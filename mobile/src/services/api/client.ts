import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const privateWebOrigin =
  Platform.OS === "web" && globalThis.location?.hostname.endsWith(".ts.net")
    ? globalThis.location.origin
    : undefined;

const DEFAULT_VITO_URL = (
  process.env.EXPO_PUBLIC_VITO_URL ??
  privateWebOrigin ??
  "https://theworstproductions.com"
).replace(/\/$/, "");
export let VITO_URL = DEFAULT_VITO_URL;

const AGENT_URL_KEY = "vito-agent-url";
const RECENT_AGENTS_KEY = "vito-recent-agents";
const LEGACY_TOKEN_KEY = "vito-dashboard-token";
const VOICE_KEY = "vito-realtime-voice";
const VOICE_MODEL_KEY = "vito-realtime-model";
const VOICE_PROVIDER_KEY = "vito-live-voice-provider";
const GEMINI_VOICE_KEY = "vito-gemini-live-voice";
let authToken: string | null = null;
const urlListeners = new Set<(url: string) => void>();

function storage() {
  return {
    get: (key: string) =>
      Platform.OS === "web"
        ? Promise.resolve(globalThis.localStorage?.getItem(key) ?? null)
        : SecureStore.getItemAsync(key),
    set: (key: string, value: string) =>
      Platform.OS === "web"
        ? Promise.resolve(globalThis.localStorage?.setItem(key, value))
        : SecureStore.setItemAsync(key, value),
    remove: (key: string) =>
      Platform.OS === "web"
        ? Promise.resolve(globalThis.localStorage?.removeItem(key))
        : SecureStore.deleteItemAsync(key),
  };
}
function tokenKey(url = VITO_URL) {
  let hash = 2166136261;
  for (const char of url) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `vito-token-${(hash >>> 0).toString(16)}`;
}
export function normalizeAgentUrl(input: string) {
  const candidate = input.trim().replace(/\/$/, "");
  const parsed = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost")
    throw new Error("Agent URL must use HTTPS");
  return parsed.origin;
}
export async function loadAgentUrl() {
  VITO_URL = (await storage().get(AGENT_URL_KEY)) || DEFAULT_VITO_URL;
  return VITO_URL;
}
export async function setAgentUrl(input: string) {
  const next = normalizeAgentUrl(input);
  VITO_URL = next;
  await storage().set(AGENT_URL_KEY, next);
  const recent = await getRecentAgents();
  await storage().set(
    RECENT_AGENTS_KEY,
    JSON.stringify([next, ...recent.filter((url) => url !== next)].slice(0, 6)),
  );
  authToken = null;
  urlListeners.forEach((listener) => listener(next));
  return next;
}
export async function getRecentAgents(): Promise<string[]> {
  try {
    return JSON.parse((await storage().get(RECENT_AGENTS_KEY)) || "[]") as string[];
  } catch {
    return [];
  }
}
export function subscribeAgentUrl(listener: (url: string) => void) {
  urlListeners.add(listener);
  return () => {
    urlListeners.delete(listener);
  };
}

export const REALTIME_VOICES = [
  "marin",
  "cedar",
  "coral",
  "sage",
  "alloy",
  "ash",
  "ballad",
  "echo",
  "shimmer",
  "verse",
] as const;
export type RealtimeVoice = (typeof REALTIME_VOICES)[number];
export const REALTIME_MODELS = ["gpt-realtime-mini", "gpt-realtime"] as const;
export type RealtimeModel = (typeof REALTIME_MODELS)[number];
export const LIVE_VOICE_PROVIDERS = ["auto", "openai", "gemini"] as const;
export type LiveVoiceProviderPreference = (typeof LIVE_VOICE_PROVIDERS)[number];
export const GEMINI_LIVE_VOICES = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
] as const;
export type GeminiLiveVoice = (typeof GEMINI_LIVE_VOICES)[number];

function isRealtimeVoice(value: string | null): value is RealtimeVoice {
  return value !== null && REALTIME_VOICES.some((voice) => voice === value);
}

export async function loadRealtimeVoice(): Promise<RealtimeVoice> {
  const value =
    Platform.OS === "web"
      ? (globalThis.localStorage?.getItem(VOICE_KEY) ?? null)
      : await SecureStore.getItemAsync(VOICE_KEY);
  return isRealtimeVoice(value) ? value : "marin";
}

export async function saveRealtimeVoice(voice: RealtimeVoice): Promise<void> {
  await storage().set(VOICE_KEY, voice);
}

export async function loadRealtimeModel(): Promise<RealtimeModel> {
  const value = await storage().get(VOICE_MODEL_KEY);
  return REALTIME_MODELS.some((model) => model === value)
    ? (value as RealtimeModel)
    : "gpt-realtime-mini";
}

export async function saveRealtimeModel(model: RealtimeModel): Promise<void> {
  await storage().set(VOICE_MODEL_KEY, model);
}

export async function loadLiveVoiceProvider(): Promise<LiveVoiceProviderPreference> {
  const value = await storage().get(VOICE_PROVIDER_KEY);
  return LIVE_VOICE_PROVIDERS.some((provider) => provider === value)
    ? (value as LiveVoiceProviderPreference)
    : "auto";
}

export async function saveLiveVoiceProvider(provider: LiveVoiceProviderPreference): Promise<void> {
  await storage().set(VOICE_PROVIDER_KEY, provider);
}

export async function loadGeminiLiveVoice(): Promise<GeminiLiveVoice> {
  const value = await storage().get(GEMINI_VOICE_KEY);
  return GEMINI_LIVE_VOICES.some((voice) => voice === value) ? (value as GeminiLiveVoice) : "Kore";
}

export async function saveGeminiLiveVoice(voice: GeminiLiveVoice): Promise<void> {
  await storage().set(GEMINI_VOICE_KEY, voice);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function loadToken(): Promise<string | null> {
  authToken = await storage().get(tokenKey());
  if (!authToken && VITO_URL === DEFAULT_VITO_URL) {
    authToken = await storage().get(LEGACY_TOKEN_KEY);
    if (authToken) await storage().set(tokenKey(), authToken);
  }
  return authToken;
}

export async function saveToken(token: string | null): Promise<void> {
  authToken = token;
  if (token) await storage().set(tokenKey(), token);
  else await storage().remove(tokenKey());
}

export const vitoTokenStore = {
  get: async () => authToken ?? (await loadToken()),
  set: saveToken,
};

export function driveFileSource(
  path: string,
): { uri: string; headers?: { Authorization: string } } | undefined {
  const marker = "/user/drive/";
  const markerIndex = path.indexOf(marker);
  if (markerIndex < 0) return undefined;
  const relativePath = path
    .slice(markerIndex + marker.length)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return {
    uri: `${VITO_URL}/api/drive/file/${relativePath}`,
    ...(authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : {}),
  };
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(`${VITO_URL}${path}`, { ...init, headers });
  const body = (await response.json().catch(() => undefined)) as
    { error?: string; message?: string } | undefined;
  if (!response.ok) {
    throw new ApiError(
      body?.error ?? body?.message ?? `Request failed (${response.status})`,
      response.status,
    );
  }
  return body as T;
}

export interface AuthStatus {
  passwordSet: boolean;
  authenticated: boolean;
}

export async function checkAuth(): Promise<AuthStatus> {
  return api<AuthStatus>("/api/auth/check");
}

export async function login(password: string): Promise<void> {
  const result = await api<{ token?: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  if (!result.token) throw new Error("The server did not return a mobile session token");
  await saveToken(result.token);
}

export async function logout(): Promise<void> {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } finally {
    await saveToken(null);
  }
}

export interface Session {
  id: string;
  alias?: string | null;
  channel: string;
  last_active_at: number;
}

export interface Message {
  id: number;
  type: string;
  content: string;
  timestamp: number;
  author?: string | null;
}

export async function getSessions(): Promise<Session[]> {
  return api<Session[]>("/api/sessions");
}

export async function getMessages(
  sessionId: string,
  filters: { thoughts: boolean; tools: boolean } = { thoughts: true, tools: true },
): Promise<Message[]> {
  const query = new URLSearchParams({
    limit: "100",
    hideThoughts: String(!filters.thoughts),
    hideTools: String(!filters.tools),
  });
  const result = await api<{ messages: Message[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages?${query}`,
  );
  return result.messages;
}

export async function sendMessage(sessionId: string, content: string): Promise<void> {
  await api("/api/chat", {
    method: "POST",
    body: JSON.stringify({ type: "chat", sessionId, content }),
  });
}

export async function persistVoiceEvent(
  sessionId: string,
  kind: "user" | "assistant" | "usage" | "session_end",
  content: string,
): Promise<void> {
  await api("/api/voice/event", {
    method: "POST",
    body: JSON.stringify({ sessionId, kind, content }),
  });
}

export interface VoiceSession {
  id: string;
  alias: string | null;
  created_at: number;
  last_active_at: number;
}

export interface VoiceSessionDetail {
  session: VoiceSession;
  messages: Message[];
  durationMs: number | null;
  usage: unknown[];
  tasks: Array<{
    id: string;
    voice_session_id: string;
    question: string;
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    result: string | null;
    error: string | null;
    created_at: number;
    updated_at: number;
  }>;
}

export async function getVoiceSessions(): Promise<VoiceSession[]> {
  return await api<VoiceSession[]>("/api/voice/sessions");
}

export async function getVoiceSession(id: string): Promise<VoiceSessionDetail | null> {
  return await api<VoiceSessionDetail | null>(`/api/voice/sessions/${encodeURIComponent(id)}`);
}

export interface VoiceTask {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  result: string | null;
  error: string | null;
}

export async function getVoiceContext(): Promise<unknown> {
  return await api("/api/voice/context");
}

export async function searchVoiceMemory(options: {
  query: string;
  mode?: "hybrid" | "semantic" | "exact";
  startDate?: string;
  endDate?: string;
  limit?: number;
}): Promise<unknown> {
  return await api("/api/voice/memory-search", {
    method: "POST",
    body: JSON.stringify(options),
  });
}

export async function startVoiceTask(sessionId: string, question: string): Promise<VoiceTask> {
  return await api<VoiceTask>("/api/voice/tasks", {
    method: "POST",
    body: JSON.stringify({ sessionId, question }),
  });
}

export async function getVoiceTask(id: string): Promise<VoiceTask | null> {
  return await api<VoiceTask | null>(`/api/voice/tasks/${encodeURIComponent(id)}`);
}

export async function cancelVoiceTask(id: string): Promise<VoiceTask> {
  return await api<VoiceTask>(`/api/voice/tasks/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
  });
}

export interface VoiceAvailability {
  available: boolean;
  provider: "openai" | "gemini" | null;
  reason: string | null;
  providers: { openai: boolean; gemini: boolean };
}

export async function getVoiceAvailability(): Promise<VoiceAvailability> {
  return await api("/api/voice/status");
}

export async function getRealtimeToken(
  voice: RealtimeVoice,
  model: RealtimeModel,
): Promise<string> {
  const result = await api<unknown>("/api/voice/realtime-token", {
    method: "POST",
    body: JSON.stringify({ voice, model }),
  });
  if (
    !result ||
    typeof result !== "object" ||
    !("value" in result) ||
    typeof result.value !== "string" ||
    !result.value
  ) {
    throw new Error(
      "Voice endpoint is unavailable. Restart the agent service to activate the backend changes.",
    );
  }
  return result.value;
}

export interface GeminiRealtimeBootstrap {
  value: string;
  model: "gemini-3.1-flash-live-preview";
  voice: GeminiLiveVoice;
  instructions: string;
  tools: Array<Record<string, unknown>>;
}

export async function getGeminiRealtimeBootstrap(
  voice: GeminiLiveVoice,
): Promise<GeminiRealtimeBootstrap> {
  return await api<GeminiRealtimeBootstrap>("/api/voice/gemini-token", {
    method: "POST",
    body: JSON.stringify({ voice }),
  });
}
