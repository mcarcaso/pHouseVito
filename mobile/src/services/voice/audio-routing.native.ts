import { setAudioModeAsync } from "expo-audio";
import InCallManager from "react-native-incall-manager";

export type VoiceAudioRoute = "speaker" | "earpiece";

async function configureRecordingSession() {
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: "doNotMix",
  });
}

export async function startVoiceAudio(route: VoiceAudioRoute): Promise<void> {
  await configureRecordingSession();
  InCallManager.start({ media: "audio", auto: false });
  await setVoiceAudioRoute(route);
}

export async function setVoiceAudioRoute(route: VoiceAudioRoute): Promise<void> {
  if (route === "speaker") {
    InCallManager.setForceSpeakerphoneOn(true);
    return;
  }

  InCallManager.setForceSpeakerphoneOn(false);
}

export function stopVoiceAudio(): void {
  InCallManager.stop();
}
