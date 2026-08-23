import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export const VITO_URL = (
  process.env.EXPO_PUBLIC_VITO_URL ?? "https://theworstproductions.com"
).replace(/\/$/, "");

const TOKEN_KEY = "vito-dashboard-token";
let authToken: string | null = null;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function loadToken(): Promise<string | null> {
  authToken =
    Platform.OS === "web"
      ? (globalThis.localStorage?.getItem(TOKEN_KEY) ?? null)
      : await SecureStore.getItemAsync(TOKEN_KEY);
  return authToken;
}

export async function saveToken(token: string | null): Promise<void> {
  authToken = token;
  if (Platform.OS === "web") {
    if (token) globalThis.localStorage?.setItem(TOKEN_KEY, token);
    else globalThis.localStorage?.removeItem(TOKEN_KEY);
  } else if (token) {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
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

export async function getMessages(sessionId: string): Promise<Message[]> {
  const result = await api<{ messages: Message[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=50&hideThoughts=true&hideTools=true`,
  );
  return result.messages;
}

export async function sendMessage(sessionId: string, content: string): Promise<void> {
  await api("/api/chat", {
    method: "POST",
    body: JSON.stringify({ type: "chat", sessionId, content }),
  });
}
