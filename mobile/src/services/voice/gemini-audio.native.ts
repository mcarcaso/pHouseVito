import { AudioContext, AudioManager, AudioRecorder } from "react-native-audio-api";
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

export async function createGeminiAudioTransport(
  onInput: (base64Pcm: string) => void,
): Promise<GeminiAudioTransport> {
  const permission = await AudioManager.requestRecordingPermissions();
  if (permission !== "Granted")
    throw new Error("Microphone permission is required for Gemini Live");
  AudioManager.setAudioSessionOptions({
    iosCategory: "playAndRecord",
    iosMode: "voiceChat",
    iosOptions: ["allowBluetoothHFP", "defaultToSpeaker"],
  });
  await AudioManager.setAudioSessionActivity(true);
  const context = new AudioContext({ sampleRate: 24_000 });
  await context.resume();
  const queue = context.createBufferQueueSource();
  queue.connect(context.destination);
  queue.start();

  const recorder = new AudioRecorder();
  const callback = recorder.onAudioReady(
    { sampleRate: 16_000, bufferLength: 1_600, channelCount: 1 },
    ({ buffer }) => onInput(pcm16Base64(buffer.getChannelData(0))),
  );
  if (callback.status === "error") throw new Error(callback.message);
  const started = await recorder.start();
  if (started.status === "error") throw new Error(started.message);

  let closed = false;
  return {
    setMuted(muted) {
      if (muted) recorder.pause();
      else recorder.resume();
    },
    async play(base64Pcm) {
      if (closed) return;
      const buffer = await context.decodePCMInBase64(base64Pcm, 24_000, 1, true);
      if (!closed) queue.enqueueBuffer(buffer);
    },
    interrupt() {
      queue.clearBuffers();
    },
    close() {
      if (closed) return;
      closed = true;
      recorder.clearOnAudioReady();
      void recorder.stop();
      queue.stop();
      void context.close();
      void AudioManager.setAudioSessionActivity(false);
    },
  };
}
