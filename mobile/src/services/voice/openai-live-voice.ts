import { connectRealtime } from "./realtime-webrtc";
import type {
  LiveVoiceConnectOptions,
  LiveVoiceEvent,
  LiveVoiceProvider,
  LiveVoiceSession,
  LiveVoiceTurn,
} from "./live-voice";

interface OpenAiRealtimeEvent {
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

function parseEvent(raw: unknown): OpenAiRealtimeEvent | null {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as OpenAiRealtimeEvent;
  } catch {
    return null;
  }
}

function historyEvent(turn: LiveVoiceTurn): unknown {
  return {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: turn.role,
      content: [
        {
          type:
            turn.role === "user"
              ? "input_text"
              : turn.role === "assistant"
                ? "output_text"
                : "input_text",
          text: turn.text,
        },
      ],
    },
  };
}

export const openAiLiveVoiceProvider: LiveVoiceProvider = {
  id: "openai",
  async connect(options: LiveVoiceConnectOptions): Promise<LiveVoiceSession> {
    let assistantDraft = "";
    const emit = options.onEvent;
    const handleRawEvent = (raw: unknown) => {
      const event = parseEvent(raw);
      if (!event) return;

      if (event.type === "input_audio_buffer.speech_started") emit({ type: "listening" });
      if (event.type === "response.output_audio.delta") emit({ type: "speaking" });
      if (event.type === "response.done") {
        emit({ type: "listening" });
        if (event.response?.usage) emit({ type: "usage", usage: event.response.usage });
      }
      if (
        event.type === "conversation.item.input_audio_transcription.completed" &&
        event.transcript
      ) {
        emit({ type: "transcript", role: "user", text: event.transcript });
      }
      if (event.type === "response.output_audio_transcript.delta" && event.delta) {
        assistantDraft += event.delta;
      }
      if (event.type === "response.output_audio_transcript.done") {
        emit({
          type: "transcript",
          role: "assistant",
          text: event.transcript ?? assistantDraft,
        });
        assistantDraft = "";
      }
      if (event.type === "response.function_call_arguments.done" && event.name && event.call_id) {
        emit({
          type: "tool_call",
          name: event.name,
          callId: event.call_id,
          arguments: event.arguments,
        });
      }
      if (
        event.type === "response.output_item.done" &&
        event.item?.type === "function_call" &&
        event.item.name &&
        event.item.call_id
      ) {
        emit({
          type: "tool_call",
          name: event.item.name,
          callId: event.item.call_id,
          arguments: event.item.arguments,
        });
      }
      if (event.type === "error") {
        emit({
          type: "error",
          message: event.error?.message ?? "OpenAI Realtime reported an error",
        });
      }
    };

    const connection = await connectRealtime(
      options.credential,
      handleRawEvent,
      options.onOpen,
      () => options.onError("The OpenAI realtime data channel failed"),
    );

    return {
      setMuted: (muted) => connection.setMuted(muted),
      addHistory: (turns) => {
        for (const turn of turns) connection.sendEvent(historyEvent(turn));
      },
      submitToolResult: (callId, result, instructions) => {
        connection.sendEvent({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify(result),
          },
        });
        connection.sendEvent({
          type: "response.create",
          response: {
            instructions:
              instructions ??
              "Use the tool result. If another tool is needed, call it silently without narrating the search. Otherwise answer the user directly.",
          },
        });
      },
      close: () => connection.close(),
    };
  },
};
