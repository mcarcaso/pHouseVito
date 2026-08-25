import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import {
  agentStorageKey,
  api,
  loadAppPreferences,
  patchAppPreferences,
} from "../services/api/client";

export type SpeechProvider = "gemini" | "openai" | "elevenlabs" | "openrouter";
export interface SpeechSettings {
  provider: SpeechProvider;
  voice: string;
  model?: string;
  rate: number;
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
const cache = new Map<string, string>();

function cacheKey(settings: SpeechSettings, text: string) {
  return `${settings.provider}:${settings.model ?? ""}:${settings.voice}:${text}`;
}

export function SpeechProviderContext({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SpeechSettings>(defaults);
  const [state, setState] = useState<SpeechState>({ id: null, status: "idle" });
  const playerRef = useRef<AudioPlayer | null>(null);
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
      playerRef.current?.remove();
    };
  }, []);

  const stop = () => {
    playerRef.current?.pause();
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
      playerRef.current?.pause();
      setState({ id, status: "paused" });
      return;
    }
    if (state.id === id && state.status === "paused") {
      playerRef.current?.play();
      setState({ id, status: "playing" });
      return;
    }
    playerRef.current?.pause();
    setState({ id, status: "loading" });
    try {
      const activeSettings = override ?? settings;
      const key = cacheKey(activeSettings, text);
      let uri = cache.get(key);
      if (!uri) {
        const result = await api<{ data: string; mimeType: string }>("/api/speech/synthesize", {
          method: "POST",
          body: JSON.stringify({ ...activeSettings, text }),
        });
        if (Platform.OS === "web") uri = `data:${result.mimeType};base64,${result.data}`;
        else {
          const extension = result.mimeType === "audio/wav" ? "wav" : "mp3";
          uri = `${FileSystem.cacheDirectory}vito-speech-${Date.now()}.${extension}`;
          await FileSystem.writeAsStringAsync(uri, result.data, {
            encoding: FileSystem.EncodingType.Base64,
          });
        }
        cache.set(key, uri);
      }
      playerRef.current?.remove();
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: "duckOthers",
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      });
      const player = createAudioPlayer(uri);
      player.setPlaybackRate(activeSettings.rate);
      player.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish) setState({ id: null, status: "idle" });
      });
      playerRef.current = player;
      player.play();
      setState({ id, status: "playing" });
    } catch (cause) {
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
