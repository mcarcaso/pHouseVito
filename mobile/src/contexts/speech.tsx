import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { api } from "../services/api/client";

export type SpeechProvider = "openai" | "elevenlabs" | "openrouter";
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

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored)
          setSettings({ ...defaults, ...(JSON.parse(stored) as Partial<SpeechSettings>) });
      })
      .catch(() => undefined);
    return () => playerRef.current?.remove();
  }, []);

  const stop = () => {
    playerRef.current?.pause();
    setState({ id: null, status: "idle" });
  };

  const updateSettings = async (next: SpeechSettings) => {
    setSettings(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
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
          uri = `${FileSystem.cacheDirectory}vito-speech-${Date.now()}.mp3`;
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
