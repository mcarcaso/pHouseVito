import {
  mediaDevices,
  RTCPeerConnection,
  RTCSessionDescription,
  type MediaStream,
} from "react-native-webrtc";

export interface VoiceConnection {
  setMuted(muted: boolean): void;
  close(): void;
}

export async function connectRealtime(
  token: string,
  onEvent: (data: unknown) => void,
  onOpen: () => void,
  onError: () => void,
): Promise<VoiceConnection> {
  const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
  const peer = new RTCPeerConnection();
  const channel = peer.createDataChannel("oai-events");
  stream.getTracks().forEach((track) => peer.addTrack(track, stream));

  channel.onmessage = (message: unknown) => onEvent((message as { data?: unknown }).data);
  channel.onopen = onOpen;
  channel.onerror = onError;

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

  return {
    setMuted(muted) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    },
    close() {
      channel.close();
      peer.close();
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}
