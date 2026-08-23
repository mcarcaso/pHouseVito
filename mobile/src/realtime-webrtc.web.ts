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
  if (!navigator.mediaDevices?.getUserMedia || !globalThis.RTCPeerConnection) {
    throw new Error("This browser does not support WebRTC voice conversations");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const peer = new RTCPeerConnection();
  const channel = peer.createDataChannel("oai-events");
  const audio = document.createElement("audio");
  audio.autoplay = true;
  audio.style.display = "none";
  document.body.appendChild(audio);

  peer.ontrack = (event) => {
    audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    void audio.play().catch(() => undefined);
  };
  stream.getTracks().forEach((track) => peer.addTrack(track, stream));
  channel.onmessage = (message) => onEvent(message.data);
  channel.onopen = onOpen;
  channel.onerror = onError;

  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/sdp" },
      body: offer.sdp,
    });
    if (!response.ok) throw new Error(`Realtime connection failed (${response.status})`);
    await peer.setRemoteDescription({ type: "answer", sdp: await response.text() });
  } catch (error) {
    channel.close();
    peer.close();
    stream.getTracks().forEach((track) => track.stop());
    audio.remove();
    throw error;
  }

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
      audio.srcObject = null;
      audio.remove();
    },
  };
}
