import { z } from "zod";

export const speechProviderSchema = z.enum(["gemini", "openai", "elevenlabs", "openrouter"]);

export const speechPreferencesSchema = z.object({
  provider: speechProviderSchema,
  voice: z.string().max(200),
  model: z.string().max(200).optional(),
  rate: z.number().min(0.5).max(2),
  instructions: z.string().max(1_000).optional(),
});

export const liveVoiceProviderPreferenceSchema = z.enum(["auto", "openai", "gemini"]);
export const realtimeModelSchema = z.enum(["gpt-realtime-mini", "gpt-realtime"]);
export const realtimeVoiceSchema = z.enum([
  "marin",
  "cedar",
  "coral",
  "sage",
  "alloy",
  "ash",
  "ballad",
  "echo",
  "shimmer",
  "verse",
]);

export const geminiLiveVoiceSchema = z.enum([
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
]);

export const voiceModePreferencesSchema = z.object({
  provider: liveVoiceProviderPreferenceSchema,
  model: realtimeModelSchema,
  openaiVoice: realtimeVoiceSchema,
  geminiVoice: geminiLiveVoiceSchema,
});

export const appPreferencesSchema = z.object({
  speech: speechPreferencesSchema.optional(),
  voiceMode: voiceModePreferencesSchema.optional(),
});

export const appPreferencesPatchSchema = appPreferencesSchema.refine(
  (preferences) => preferences.speech !== undefined || preferences.voiceMode !== undefined,
  "At least one preference group is required",
);

export const appPreferencesResponseSchema = z.object({
  preferences: appPreferencesSchema,
  updatedAt: z.number().int().nonnegative().nullable(),
});

export type AppPreferences = z.infer<typeof appPreferencesSchema>;
