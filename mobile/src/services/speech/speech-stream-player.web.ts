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

export async function createSpeechStreamPlayer({
  rate,
  onStarted,
  onEnded,
}: SpeechStreamPlayerOptions): Promise<SpeechStreamPlayer> {
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
