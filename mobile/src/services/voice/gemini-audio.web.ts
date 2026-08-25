import type { GeminiAudioTransport } from "./gemini-audio";

function pcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary);
}

function downsample(samples: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === 16_000) return samples;
  const ratio = sourceRate / 16_000;
  const result = new Float32Array(Math.floor(samples.length / ratio));
  for (let index = 0; index < result.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(samples.length, Math.floor((index + 1) * ratio));
    let total = 0;
    for (let source = start; source < end; source += 1) total += samples[source] ?? 0;
    result[index] = total / Math.max(1, end - start);
  }
  return result;
}

function decodePcm16(base64: string): Float32Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(Math.floor(bytes.length / 2));
  for (let index = 0; index < samples.length; index += 1) {
    const value = view.getInt16(index * 2, true);
    samples[index] = value / (value < 0 ? 0x8000 : 0x7fff);
  }
  return samples;
}

export async function createGeminiAudioTransport(
  onInput: (base64Pcm: string) => void,
): Promise<GeminiAudioTransport> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access is unavailable");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const context = new AudioContext({ sampleRate: 24_000 });
  await context.resume();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4_096, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0;
  source.connect(processor);
  processor.connect(silent);
  silent.connect(context.destination);
  processor.onaudioprocess = (event) => {
    const samples = event.inputBuffer.getChannelData(0);
    onInput(pcm16Base64(downsample(samples, context.sampleRate)));
  };

  let nextPlaybackTime = 0;
  let closed = false;
  const playing = new Set<AudioBufferSourceNode>();
  const interrupt = () => {
    for (const player of playing) {
      try {
        player.stop();
      } catch {
        // The source may already have ended.
      }
    }
    playing.clear();
    nextPlaybackTime = context.currentTime;
  };
  return {
    setMuted(muted) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    },
    async play(base64Pcm) {
      if (closed) return;
      const samples = decodePcm16(base64Pcm);
      const buffer = context.createBuffer(1, samples.length, 24_000);
      buffer.copyToChannel(new Float32Array(samples), 0);
      const player = context.createBufferSource();
      player.buffer = buffer;
      player.connect(context.destination);
      playing.add(player);
      player.onended = () => playing.delete(player);
      nextPlaybackTime = Math.max(context.currentTime, nextPlaybackTime);
      player.start(nextPlaybackTime);
      nextPlaybackTime += buffer.duration;
    },
    interrupt,
    close() {
      if (closed) return;
      closed = true;
      interrupt();
      processor.disconnect();
      source.disconnect();
      silent.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}
