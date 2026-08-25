import type {
  LiveVoiceConnectOptions,
  LiveVoiceProvider,
  LiveVoiceSession,
  LiveVoiceTurn,
} from "./live-voice";

interface GeminiBootstrapMetadata {
  model: string;
  voice: string;
  instructions: string;
  tools: Array<Record<string, unknown>>;
}

interface GeminiMessage {
  setupComplete?: unknown;
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    modelTurn?: {
      parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }>;
    };
  };
  toolCall?: {
    functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>;
  };
  usageMetadata?: unknown;
  error?: { message?: string };
}

async function websocketMessageText(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return await data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  return String(data);
}

function metadata(value: unknown): GeminiBootstrapMetadata {
  if (!value || typeof value !== "object") throw new Error("Gemini session metadata is missing");
  const candidate = value as Partial<GeminiBootstrapMetadata>;
  if (
    typeof candidate.model !== "string" ||
    typeof candidate.voice !== "string" ||
    typeof candidate.instructions !== "string" ||
    !Array.isArray(candidate.tools)
  ) {
    throw new Error("Gemini session metadata is invalid");
  }
  return candidate as GeminiBootstrapMetadata;
}

function turnPayload(turns: LiveVoiceTurn[]) {
  return {
    clientContent: {
      turns: turns.map((turn) => ({
        role: turn.role === "assistant" ? "model" : "user",
        parts: [{ text: turn.role === "system" ? `[System context] ${turn.text}` : turn.text }],
      })),
      turnComplete: false,
    },
  };
}

export const geminiLiveVoiceProvider: LiveVoiceProvider = {
  id: "gemini",
  async connect(options: LiveVoiceConnectOptions): Promise<LiveVoiceSession> {
    const config = metadata(options.metadata);
    let socket: WebSocket;
    let ready = false;
    let closed = false;
    let userTranscript = "";
    let assistantTranscript = "";
    const toolNames = new Map<string, string>();
    const pending: unknown[] = [];
    const send = (value: unknown) => {
      if (socket.readyState === WebSocket.OPEN && ready) socket.send(JSON.stringify(value));
      else pending.push(value);
    };
    const { createGeminiAudioTransport } = await import("./gemini-audio");
    const audio = await createGeminiAudioTransport((base64Pcm) => {
      if (!socket || !ready || socket.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({
          realtimeInput: {
            audio: { data: base64Pcm, mimeType: "audio/pcm;rate=16000" },
          },
        }),
      );
    });
    socket = new WebSocket(
      `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(options.credential)}`,
    );
    socket.binaryType = "arraybuffer";
    const connectionTimer = setTimeout(() => {
      if (ready || closed) return;
      closed = true;
      audio.close();
      socket.close();
      options.onError("Gemini Live did not finish connecting");
    }, 15_000);

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          setup: {
            model: `models/${config.model}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice } },
              },
            },
            systemInstruction: { parts: [{ text: config.instructions }] },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            tools: [{ functionDeclarations: config.tools }],
          },
        }),
      );
    };
    socket.onmessage = async (raw) => {
      let message: GeminiMessage;
      try {
        message = JSON.parse(await websocketMessageText(raw.data)) as GeminiMessage;
      } catch {
        return;
      }
      if (message.setupComplete !== undefined) {
        clearTimeout(connectionTimer);
        ready = true;
        for (const value of pending.splice(0)) socket.send(JSON.stringify(value));
        options.onOpen();
      }
      const content = message.serverContent;
      if (content?.interrupted) {
        audio.interrupt();
        assistantTranscript = "";
        options.onEvent({ type: "listening" });
      }
      if (content?.inputTranscription?.text) {
        userTranscript += content.inputTranscription.text;
        options.onEvent({ type: "listening" });
      }
      if (content?.outputTranscription?.text) {
        assistantTranscript += content.outputTranscription.text;
      }
      for (const part of content?.modelTurn?.parts ?? []) {
        const audioData = part.inlineData;
        if (audioData?.data && audioData.mimeType?.startsWith("audio/pcm")) {
          options.onEvent({ type: "speaking" });
          void audio.play(audioData.data);
        }
      }
      if (content?.turnComplete) {
        if (userTranscript.trim()) {
          options.onEvent({ type: "transcript", role: "user", text: userTranscript });
        }
        if (assistantTranscript.trim()) {
          options.onEvent({
            type: "transcript",
            role: "assistant",
            text: assistantTranscript,
          });
        }
        userTranscript = "";
        assistantTranscript = "";
        options.onEvent({ type: "listening" });
      }
      for (const call of message.toolCall?.functionCalls ?? []) {
        if (call.id && call.name) {
          toolNames.set(call.id, call.name);
          options.onEvent({
            type: "tool_call",
            callId: call.id,
            name: call.name,
            arguments: JSON.stringify(call.args ?? {}),
          });
        }
      }
      if (message.usageMetadata) {
        options.onEvent({ type: "usage", usage: message.usageMetadata });
      }
      if (message.error) {
        options.onEvent({ type: "error", message: message.error.message ?? "Gemini Live error" });
      }
    };
    socket.onerror = () => options.onError("The Gemini Live WebSocket failed");
    socket.onclose = (event) => {
      clearTimeout(connectionTimer);
      if (!closed) {
        closed = true;
        audio.close();
        options.onError(event.reason || "Gemini Live connection closed");
      }
    };

    return {
      setMuted: (muted) => audio.setMuted(muted),
      addHistory: (turns) => send(turnPayload(turns)),
      submitToolResult: (callId, result, instructions) => {
        send({
          toolResponse: {
            functionResponses: [
              {
                id: callId,
                name: toolNames.get(callId),
                response: { result, ...(instructions ? { instructions } : {}) },
              },
            ],
          },
        });
      },
      close: () => {
        if (closed) return;
        clearTimeout(connectionTimer);
        closed = true;
        audio.close();
        socket.close();
      },
    };
  },
};
