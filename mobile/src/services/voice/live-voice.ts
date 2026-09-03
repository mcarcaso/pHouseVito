export type LiveVoiceProviderId = "openai" | "gemini" | "elevenlabs";

export interface LiveVoiceTurn {
  role: "user" | "assistant" | "system";
  text: string;
}

export type LiveVoiceEvent =
  | { type: "listening" }
  | { type: "speaking" }
  | { type: "speech_activity"; role: "user" | "assistant"; active: boolean }
  | { type: "transcript"; role: "user" | "assistant"; text: string }
  | { type: "usage"; usage: unknown }
  | { type: "tool_call"; name: string; callId: string; arguments?: string }
  | { type: "error"; message: string };

export interface LiveVoiceSession {
  setMuted(muted: boolean): void;
  addHistory(turns: LiveVoiceTurn[]): void;
  requestResponse(instructions: string): void;
  submitToolResult(callId: string, result: unknown, instructions?: string): void;
  close(): void;
}

export interface LiveVoiceConnectOptions {
  credential: string;
  metadata?: unknown;
  onEvent: (event: LiveVoiceEvent) => void;
  onOpen: () => void;
  onError: (message: string) => void;
}

export interface LiveVoiceProvider {
  readonly id: LiveVoiceProviderId;
  connect(options: LiveVoiceConnectOptions): Promise<LiveVoiceSession>;
}
