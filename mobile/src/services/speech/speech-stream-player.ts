export interface SpeechStreamPlayer {
  enqueue(chunk: Uint8Array): Promise<void>;
  finish(): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): void;
}

export interface SpeechStreamPlayerOptions {
  rate: number;
  onStarted: () => void;
  onEnded: () => void;
}

export async function createSpeechStreamPlayer(
  _options: SpeechStreamPlayerOptions,
): Promise<SpeechStreamPlayer> {
  throw new Error("Streaming speech playback is unavailable on this platform");
}
