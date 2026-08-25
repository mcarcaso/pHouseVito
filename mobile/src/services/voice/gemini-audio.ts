export interface GeminiAudioTransport {
  setMuted(muted: boolean): void;
  play(base64Pcm: string): Promise<void>;
  interrupt(): void;
  close(): void;
}

export async function createGeminiAudioTransport(
  _onInput: (base64Pcm: string) => void,
): Promise<GeminiAudioTransport> {
  throw new Error("Gemini audio is unavailable on this platform");
}
