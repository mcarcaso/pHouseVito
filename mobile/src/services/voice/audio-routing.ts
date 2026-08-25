export type VoiceAudioRoute = "speaker" | "earpiece";

export async function startVoiceAudio(_route: VoiceAudioRoute): Promise<void> {}

export async function setVoiceAudioRoute(_route: VoiceAudioRoute): Promise<void> {}

export function stopVoiceAudio(): void {}
