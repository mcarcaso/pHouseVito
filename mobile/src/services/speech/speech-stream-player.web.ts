import type { SpeechStreamPlayer, SpeechStreamPlayerOptions } from "./speech-stream-player";

function decodePcm16(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let index = 0; index < samples.length; index += 1) {
    const value = view.getInt16(index * 2, true);
    samples[index] = value / (value < 0 ? 0x8000 : 0x7fff);
  }
  return samples;
}

// AudioBufferSourceNode rate changes also transpose speech. For adjusted speeds,
// use the browser's pitch-preserving media playback on a complete PCM/WAV clip.
function createPitchPreservingPlayer({
  rate,
  onStarted,
  onEnded,
}: SpeechStreamPlayerOptions): SpeechStreamPlayer {
  const chunks: Uint8Array[] = [];
  const audio = new Audio();
  audio.playbackRate = rate;
  audio.preservesPitch = true;
  let stopped = false;
  let url: string | undefined;
  const release = () => {
    if (url) URL.revokeObjectURL(url);
    url = undefined;
  };
  audio.onplaying = () => {
    if (!stopped) onStarted();
  };
  audio.onended = () => {
    release();
    if (!stopped) onEnded();
  };
  return {
    async enqueue(chunk) {
      if (!stopped) chunks.push(chunk.slice());
    },
    finish() {
      if (stopped) return;
      const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const pcmSize = size - (size % 2);
      const wav = new Uint8Array(44 + size);
      const view = new DataView(wav.buffer);
      const tag = (offset: number, value: string) => {
        for (let i = 0; i < value.length; i++) wav[offset + i] = value.charCodeAt(i);
      };
      tag(0, "RIFF");
      view.setUint32(4, 36 + pcmSize, true);
      tag(8, "WAVE");
      tag(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 24_000, true);
      view.setUint32(28, 48_000, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      tag(36, "data");
      view.setUint32(40, pcmSize, true);
      let offset = 44;
      for (const chunk of chunks) {
        wav.set(chunk, offset);
        offset += chunk.length;
      }
      chunks.length = 0;
      url = URL.createObjectURL(new Blob([wav.slice(0, 44 + pcmSize)], { type: "audio/wav" }));
      audio.src = url;
      audio.playbackRate = rate;
      void audio.play().catch(() => {
        release();
        if (!stopped) onEnded();
      });
    },
    async pause() {
      audio.pause();
    },
    async resume() {
      if (!stopped) await audio.play();
    },
    stop() {
      stopped = true;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      chunks.length = 0;
      release();
    },
  };
}

export async function createSpeechStreamPlayer({
  rate,
  onStarted,
  onEnded,
}: SpeechStreamPlayerOptions): Promise<SpeechStreamPlayer> {
  if (rate !== 1) return createPitchPreservingPlayer({ rate, onStarted, onEnded });
  const context = new AudioContext({ sampleRate: 24_000 });
  await context.resume();
  let nextPlaybackTime = context.currentTime;
  let pendingBuffers = 0;
  let inputFinished = false;
  let started = false;
  let stopped = false;
  let trailingByte: number | undefined;
  const sources = new Set<AudioBufferSourceNode>();

  const maybeEnd = () => {
    if (!stopped && inputFinished && pendingBuffers === 0) onEnded();
  };

  return {
    async enqueue(chunk) {
      if (stopped || chunk.byteLength === 0) return;
      let bytes = chunk;
      if (trailingByte !== undefined) {
        const combined = new Uint8Array(chunk.byteLength + 1);
        combined[0] = trailingByte;
        combined.set(chunk, 1);
        bytes = combined;
        trailingByte = undefined;
      }
      if (bytes.byteLength % 2 !== 0) {
        trailingByte = bytes[bytes.byteLength - 1];
        bytes = bytes.subarray(0, bytes.byteLength - 1);
      }
      if (bytes.byteLength === 0) return;

      const samples = decodePcm16(bytes);
      const buffer = context.createBuffer(1, samples.length, 24_000);
      buffer.copyToChannel(new Float32Array(samples), 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      source.connect(context.destination);
      sources.add(source);
      pendingBuffers += 1;
      source.onended = () => {
        sources.delete(source);
        pendingBuffers = Math.max(0, pendingBuffers - 1);
        maybeEnd();
      };
      nextPlaybackTime = Math.max(context.currentTime, nextPlaybackTime);
      source.start(nextPlaybackTime);
      nextPlaybackTime += buffer.duration / rate;
      if (!started) {
        started = true;
        onStarted();
      }
    },
    finish() {
      inputFinished = true;
      trailingByte = undefined;
      maybeEnd();
    },
    async pause() {
      if (!stopped) await context.suspend();
    },
    async resume() {
      if (!stopped) await context.resume();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // The source may already have ended.
        }
      }
      sources.clear();
      void context.close();
    },
  };
}
