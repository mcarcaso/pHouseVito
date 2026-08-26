import { AudioContext, AudioManager } from "react-native-audio-api";
import type { SpeechStreamPlayer, SpeechStreamPlayerOptions } from "./speech-stream-player";

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary);
}

export async function createSpeechStreamPlayer({
  rate,
  onStarted,
  onEnded,
}: SpeechStreamPlayerOptions): Promise<SpeechStreamPlayer> {
  AudioManager.setAudioSessionOptions({
    iosCategory: "playback",
    iosMode: "spokenAudio",
    iosOptions: ["duckOthers"],
    iosNotifyOthersOnDeactivation: true,
  });
  await AudioManager.setAudioSessionActivity(true);
  const context = new AudioContext({ sampleRate: 24_000 });
  await context.resume();
  const queue = context.createBufferQueueSource();
  queue.playbackRate.value = rate;
  queue.connect(context.destination);
  queue.start(0, 0);

  let pendingBuffers = 0;
  let inputFinished = false;
  let started = false;
  let stopped = false;
  let trailingByte: number | undefined;

  const maybeEnd = () => {
    if (!stopped && inputFinished && pendingBuffers === 0) onEnded();
  };
  queue.onBufferEnded = () => {
    pendingBuffers = Math.max(0, pendingBuffers - 1);
    maybeEnd();
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
      const buffer = await context.decodePCMInBase64(base64(bytes), 24_000, 1, true);
      if (stopped) return;
      pendingBuffers += 1;
      queue.enqueueBuffer(buffer);
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
      queue.onBufferEnded = null;
      queue.clearBuffers();
      queue.stop();
      void context.close();
      void AudioManager.setAudioSessionActivity(false);
    },
  };
}
