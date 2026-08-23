export interface VoiceConnection {
  setMuted(muted: boolean): void;
  close(): void;
}

export async function connectRealtime(
  _token: string,
  _onEvent: (data: unknown) => void,
  _onOpen: () => void,
  _onError: () => void,
): Promise<VoiceConnection> {
  throw new Error("No WebRTC implementation is available for this platform");
}
