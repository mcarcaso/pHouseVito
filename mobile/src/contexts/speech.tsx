import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  agentStorageKey,
  apiStream,
  loadAppPreferences,
  patchAppPreferences,
} from "../services/api/client";
import {
  createSpeechStreamPlayer,
  type SpeechStreamPlayer,
} from "../services/speech/speech-stream-player";

export type SpeechProvider = "gemini" | "openai" | "elevenlabs" | "openrouter";
export interface SpeechSettings {
  provider: SpeechProvider;
  voice: string;
  model?: string;
  rate: number;
  instructions?: string;
}
interface SpeechState {
  id: string | null;
  status: "idle" | "loading" | "playing" | "paused";
  error?: string;
}
interface SpeechContextValue {
  settings: SpeechSettings;
  state: SpeechState;
  updateSettings: (settings: SpeechSettings) => Promise<void>;
  toggle: (id: string, text: string, override?: SpeechSettings) => Promise<void>;
  stop: () => void;
}

const STORAGE_KEY = "vito-app-speech-settings-v1";
const PENDING_SYNC_KEY = "vito-app-speech-settings-pending-sync-v1";
const defaults: SpeechSettings = { provider: "openai", voice: "alloy", rate: 1 };
const SpeechContext = createContext<SpeechContextValue | null>(null);
const cache = new Map<string, Uint8Array[]>();
const STREAM_BUFFER_BYTES = 8_192;

function cacheAudio(key: string, chunks: Uint8Array[]) {
  cache.delete(key);
  cache.set(key, chunks);
  while (cache.size > 20) cache.delete(cache.keys().next().value as string);
}

function cacheKey(settings: SpeechSettings, text: string) {
  return `${settings.provider}:${settings.model ?? ""}:${settings.voice}:${settings.instructions ?? ""}:${text}`;
}

export function SpeechProviderContext({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SpeechSettings>(defaults);
  const [state, setState] = useState<SpeechState>({ id: null, status: "idle" });
  const playerRef = useRef<SpeechStreamPlayer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);
  const editedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let local = defaults;
      let pendingSync = false;
      try {
        const [scopedStored, legacyStored, pending] = await Promise.all([
          AsyncStorage.getItem(agentStorageKey(STORAGE_KEY)),
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(agentStorageKey(PENDING_SYNC_KEY)),
        ]);
        const stored = scopedStored ?? legacyStored;
        if (stored) local = { ...defaults, ...(JSON.parse(stored) as Partial<SpeechSettings>) };
        pendingSync = pending === "true";
      } catch {
        // Ignore malformed or unavailable local storage and use defaults.
      }
      if (!cancelled && !editedRef.current) setSettings(local);
      try {
        if (pendingSync) {
          await patchAppPreferences({ speech: local });
          await AsyncStorage.removeItem(agentStorageKey(PENDING_SYNC_KEY));
          return;
        }
        const remote = (await loadAppPreferences()).preferences.speech;
        if (cancelled || editedRef.current) return;
        if (remote) {
          setSettings(remote);
          await AsyncStorage.setItem(agentStorageKey(STORAGE_KEY), JSON.stringify(remote));
        } else {
          await patchAppPreferences({ speech: local });
        }
      } catch {
        // Local preferences remain usable while the server is unavailable.
      }
    })();
    return () => {
      cancelled = true;
      runRef.current += 1;
      abortRef.current?.abort();
      playerRef.current?.stop();
    };
  }, []);

  const stop = () => {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    playerRef.current?.stop();
    playerRef.current = null;
    setState({ id: null, status: "idle" });
  };

  const updateSettings = async (next: SpeechSettings) => {
    editedRef.current = true;
    setSettings(next);
    await Promise.all([
      AsyncStorage.setItem(agentStorageKey(STORAGE_KEY), JSON.stringify(next)),
      AsyncStorage.setItem(agentStorageKey(PENDING_SYNC_KEY), "true"),
    ]);
    try {
      await patchAppPreferences({ speech: next });
      await AsyncStorage.removeItem(agentStorageKey(PENDING_SYNC_KEY));
    } catch {
      // Keep the pending marker so the local preference syncs on the next launch.
    }
    stop();
  };

  const toggle = async (id: string, text: string, override?: SpeechSettings) => {
    if (state.id === id && state.status === "playing") {
      await playerRef.current?.pause();
      setState({ id, status: "paused" });
      return;
    }
    if (state.id === id && state.status === "paused") {
      await playerRef.current?.resume();
      setState({ id, status: "playing" });
      return;
    }

    runRef.current += 1;
    const run = runRef.current;
    abortRef.current?.abort();
    playerRef.current?.stop();
    const abort = new AbortController();
    abortRef.current = abort;
    setState({ id, status: "loading" });

    try {
      const activeSettings = override ?? settings;
      const key = cacheKey(activeSettings, text);
      const player = await createSpeechStreamPlayer({
        rate: activeSettings.rate,
        onStarted: () => {
          if (runRef.current === run) setState({ id, status: "playing" });
        },
        onEnded: () => {
          if (runRef.current === run) {
            playerRef.current = null;
            abortRef.current = null;
            setState({ id: null, status: "idle" });
          }
        },
      });
      if (runRef.current !== run) {
        player.stop();
        return;
      }
      playerRef.current = player;

      const cached = cache.get(key);
      if (cached) {
        for (const chunk of cached) await player.enqueue(chunk);
        player.finish();
        return;
      }

      const response = await apiStream("/api/speech/stream", {
        method: "POST",
        body: JSON.stringify({ ...activeSettings, text }),
        signal: abort.signal,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => undefined)) as
          { error?: string; message?: string } | undefined;
        throw new Error(body?.error ?? body?.message ?? `Speech failed (${response.status})`);
      }
      if (!response.body) throw new Error("Speech provider returned an empty stream");

      const chunks: Uint8Array[] = [];
      const reader = response.body.getReader();
      let pending = new Uint8Array(0);
      while (runRef.current === run) {
        const { done, value } = await reader.read();
        if (done) break;
        const combined = new Uint8Array(pending.byteLength + value.byteLength);
        combined.set(pending);
        combined.set(value, pending.byteLength);
        let offset = 0;
        while (combined.byteLength - offset >= STREAM_BUFFER_BYTES) {
          const chunk = combined.slice(offset, offset + STREAM_BUFFER_BYTES);
          chunks.push(chunk);
          await player.enqueue(chunk);
          offset += STREAM_BUFFER_BYTES;
        }
        pending = combined.slice(offset);
      }
      if (runRef.current !== run) {
        await reader.cancel();
        return;
      }
      if (pending.byteLength > 0) {
        chunks.push(pending);
        await player.enqueue(pending);
      }
      if (chunks.length === 0) throw new Error("Speech provider returned no audio");
      cacheAudio(key, chunks);
      player.finish();
    } catch (cause) {
      if (abort.signal.aborted || runRef.current !== run) return;
      playerRef.current?.stop();
      playerRef.current = null;
      abortRef.current = null;
      setState({
        id,
        status: "idle",
        error: cause instanceof Error ? cause.message : "Speech failed",
      });
    }
  };

  return (
    <SpeechContext.Provider value={{ settings, state, updateSettings, toggle, stop }}>
      {children}
    </SpeechContext.Provider>
  );
}

export function useSpeech() {
  const value = useContext(SpeechContext);
  if (!value) throw new Error("useSpeech must be used inside SpeechProviderContext");
  return value;
}
