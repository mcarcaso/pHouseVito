import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  mediaDevices,
  RTCPeerConnection,
  RTCSessionDescription,
  type MediaStream,
} from "react-native-webrtc";
import { getRealtimeToken } from "./api";

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
}

export function VoiceScreen({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [state, setState] = useState<VoiceState>("idle");
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<ReturnType<RTCPeerConnection["createDataChannel"]> | null>(null);
  const assistantDraftRef = useRef("");
  const lineIdRef = useRef(0);

  const addLine = useCallback((role: "Mike" | "Vito", text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setTranscript((current) => [...current, { id: ++lineIdRef.current, role, text: clean }]);
  }, []);

  const stop = useCallback(() => {
    channelRef.current?.close();
    peerRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    channelRef.current = null;
    peerRef.current = null;
    streamRef.current = null;
    assistantDraftRef.current = "";
    setMuted(false);
    setState("idle");
  }, []);

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
      if (event.type === "response.done") setState("listening");
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
      if (event.type === "error") {
        setError(event.error?.message ?? "OpenAI Realtime reported an error");
        setState("error");
      }
    },
    [addLine],
  );

  const start = async () => {
    if (state !== "idle" && state !== "error") return;
    setState("connecting");
    setError(null);
    setTranscript([]);
    try {
      const token = await getRealtimeToken();
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      const peer = new RTCPeerConnection();
      const channel = peer.createDataChannel("oai-events");
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));

      streamRef.current = stream;
      peerRef.current = peer;
      channelRef.current = channel;

      channel.onmessage = (message: unknown) => handleEvent((message as { data?: unknown }).data);
      channel.onopen = () => setState("listening");
      channel.onerror = () => {
        setError("The realtime data channel failed");
        setState("error");
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/sdp" },
        body: offer.sdp,
      });
      if (!response.ok) throw new Error(`Realtime connection failed (${response.status})`);
      await peer.setRemoteDescription(
        new RTCSessionDescription({ type: "answer", sdp: await response.text() }),
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
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  };

  const active = state !== "idle" && state !== "error";
  return (
    <View style={styles.root}>
      <Text style={styles.eyebrow}>OPENAI REALTIME MINI</Text>
      <Text style={styles.title}>Live voice</Text>
      <Text style={styles.subtitle}>
        A direct speech-to-speech test. Memory and Vito tools come next.
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
          <Pressable onPress={toggleMute} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>{muted ? "Unmute" : "Mute"}</Text>
          </Pressable>
        )}
        <Pressable
          onPress={active ? stop : () => void start()}
          style={[styles.primaryButton, active && styles.stopButton]}
        >
          <Text style={styles.primaryText}>{active ? "End session" : "Start voice"}</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent}>
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
  controls: { flexDirection: "row", gap: 10, marginTop: 24 },
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
