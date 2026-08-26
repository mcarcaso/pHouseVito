import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSpeech, type SpeechProvider } from "../../contexts/speech";
import { api } from "../../services/api/client";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";

interface Voice {
  id: string;
  name: string;
}
interface SpeechModel {
  id: string;
  name: string;
  voices: Voice[];
}
const providers: Array<{ id: SpeechProvider; name: string; detail: string }> = [
  { id: "gemini", name: "Gemini", detail: "Expressive, controllable speech" },
  { id: "openai", name: "OpenAI", detail: "Fast, natural speech" },
  { id: "elevenlabs", name: "ElevenLabs", detail: "Your ElevenLabs voice library" },
  { id: "openrouter", name: "OpenRouter", detail: "Audio models through OpenRouter" },
];

export function SpeechSettingsScreen() {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const speech = useSpeech();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [models, setModels] = useState<SpeechModel[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [instructionDraft, setInstructionDraft] = useState(speech.settings.instructions ?? "");
  const [suggestingInstructions, setSuggestingInstructions] = useState(false);
  const [instructionError, setInstructionError] = useState<string | null>(null);

  useEffect(() => {
    setInstructionDraft(speech.settings.instructions ?? "");
  }, [speech.settings.instructions]);

  useEffect(() => {
    setLoading(true);
    void api<{ configured: boolean; voices: Voice[]; models: SpeechModel[] }>(
      `/api/speech/voices?provider=${speech.settings.provider}`,
    )
      .then((result) => {
        setConfigured(result.configured);
        setModels(result.models);
        if (speech.settings.provider !== "openrouter") {
          setVoices(result.voices);
          return;
        }
        const selected =
          result.models.find((model) => model.id === speech.settings.model) ?? result.models[0];
        setVoices(selected?.voices ?? []);
        if (!selected) return;
        const selectedVoice = selected.voices.some((voice) => voice.id === speech.settings.voice)
          ? speech.settings.voice
          : (selected.voices[0]?.id ?? "");
        if (speech.settings.model !== selected.id || speech.settings.voice !== selectedVoice) {
          void speech.updateSettings({
            ...speech.settings,
            model: selected.id,
            voice: selectedVoice,
          });
        }
      })
      .finally(() => setLoading(false));
  }, [speech.settings.provider]);

  const updateProvider = async (provider: SpeechProvider) => {
    await speech.updateSettings({
      provider,
      voice: provider === "gemini" ? "Enceladus" : provider === "openai" ? "alloy" : "",
      model: provider === "openrouter" ? "" : undefined,
      rate: speech.settings.rate,
      instructions: speech.settings.instructions,
    });
  };
  const speechSettingsWithDraft = () => ({
    ...speech.settings,
    instructions: instructionDraft.trim() || undefined,
  });
  const saveInstructionDraft = async () => {
    const next = speechSettingsWithDraft();
    if (next.instructions === speech.settings.instructions) return;
    await speech.updateSettings(next);
  };
  const suggestInstructions = async () => {
    setSuggestingInstructions(true);
    setInstructionError(null);
    try {
      await saveInstructionDraft();
      const result = await api<{ instructions: string }>("/api/speech/suggest-instructions", {
        method: "POST",
      });
      setInstructionDraft(result.instructions);
      await speech.updateSettings({ ...speech.settings, instructions: result.instructions });
    } catch (error) {
      setInstructionError(
        error instanceof Error ? error.message : "Could not suggest a speaking style",
      );
    } finally {
      setSuggestingInstructions(false);
    }
  };
  const supportsSpeakingStyle = speech.settings.provider !== "elevenlabs";
  const selectedModel = models.find((model) => model.id === speech.settings.model);
  const selectedVoice = voices.find((voice) => voice.id === speech.settings.voice);
  const filteredVoices = voices.filter((voice) =>
    voice.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.sectionTitle}>Speech</Text>
      <Text style={styles.sectionDescription}>Choose how assistant messages are read aloud.</Text>
      <View style={styles.providerList}>
        {providers.map((provider) => {
          const selected = speech.settings.provider === provider.id;
          return (
            <Pressable
              key={provider.id}
              onPress={() => void updateProvider(provider.id)}
              style={[styles.providerRow, selected && styles.providerRowSelected]}
            >
              <View style={styles.providerIcon}>
                <Ionicons
                  name="volume-high-outline"
                  size={18}
                  color={selected ? theme.colors.accent : theme.colors.textMuted}
                />
              </View>
              <View style={styles.copy}>
                <Text style={styles.providerName}>{provider.name}</Text>
                <Text style={styles.providerDetail}>{provider.detail}</Text>
              </View>
              {selected && (
                <Ionicons name="checkmark-circle" size={21} color={theme.colors.accent} />
              )}
            </Pressable>
          );
        })}
      </View>
      {!configured && (
        <View style={styles.warning}>
          <Ionicons name="key-outline" size={17} color={theme.colors.warning} />
          <Text style={styles.warningText}>
            This provider’s API key is not configured in Secrets.
          </Text>
        </View>
      )}
      {speech.settings.provider === "openrouter" && (
        <>
          <Text style={styles.fieldLabel}>MODEL</Text>
          <Pressable
            disabled={loading || !configured || models.length === 0}
            onPress={() => setModelOpen(true)}
            style={styles.selector}
          >
            <Text style={styles.selectorText}>{selectedModel?.name ?? "Choose a model"}</Text>
            <Ionicons name="chevron-down" size={17} color={theme.colors.textMuted} />
          </Pressable>
        </>
      )}
      <Text style={styles.fieldLabel}>VOICE</Text>
      <Pressable
        disabled={loading || !configured || voices.length === 0}
        onPress={() => setVoiceOpen(true)}
        style={styles.selector}
      >
        {loading ? (
          <ActivityIndicator size="small" color={theme.colors.accent} />
        ) : (
          <Text style={styles.selectorText}>
            {selectedVoice?.name || (configured ? "Choose a voice" : "Unavailable")}
          </Text>
        )}
        <Ionicons name="chevron-down" size={17} color={theme.colors.textMuted} />
      </Pressable>
      <Text style={styles.fieldLabel}>PLAYBACK SPEED</Text>
      <View style={styles.speedRow}>
        {[0.8, 1, 1.2, 1.5].map((rate) => (
          <Pressable
            key={rate}
            onPress={() => void speech.updateSettings({ ...speech.settings, rate })}
            style={[styles.speed, speech.settings.rate === rate && styles.speedSelected]}
          >
            <Text
              style={[styles.speedText, speech.settings.rate === rate && styles.speedTextSelected]}
            >
              {rate}×
            </Text>
          </Pressable>
        ))}
      </View>
      {supportsSpeakingStyle && (
        <>
          <Text style={styles.fieldLabel}>SPEAKING STYLE</Text>
          <TextInput
            value={instructionDraft}
            onChangeText={setInstructionDraft}
            onBlur={() => void saveInstructionDraft()}
            placeholder="Natural, warm, conversational…"
            placeholderTextColor={theme.colors.textMuted}
            multiline
            maxLength={1_000}
            style={[styles.input, styles.instructionsInput]}
          />
          <Text style={styles.fieldHelp}>
            Controls audible delivery. Leave blank to use the provider’s neutral default.
          </Text>
          <Pressable
            disabled={suggestingInstructions}
            onPress={() => void suggestInstructions()}
            style={[styles.suggest, suggestingInstructions && styles.disabled]}
          >
            {suggestingInstructions ? (
              <ActivityIndicator size="small" color={theme.colors.accent} />
            ) : (
              <Ionicons name="sparkles-outline" size={16} color={theme.colors.accent} />
            )}
            <Text style={styles.suggestText}>
              {suggestingInstructions ? "Asking your agent…" : "Suggest from Soul"}
            </Text>
          </Pressable>
          {!!instructionError && <Text style={styles.error}>{instructionError}</Text>}
        </>
      )}
      <Pressable
        disabled={!configured || !speech.settings.voice}
        onPress={() =>
          void (async () => {
            const next = speechSettingsWithDraft();
            if (next.instructions !== speech.settings.instructions) {
              await speech.updateSettings(next);
            }
            await speech.toggle(
              "voice-preview",
              "This is how your agent will sound when reading messages aloud.",
              next,
            );
          })()
        }
        style={[styles.preview, (!configured || !speech.settings.voice) && styles.disabled]}
      >
        {speech.state.id === "voice-preview" && speech.state.status === "loading" ? (
          <ActivityIndicator color={theme.colors.accentText} />
        ) : (
          <Ionicons
            name={
              speech.state.id === "voice-preview" && speech.state.status === "playing"
                ? "pause"
                : "play"
            }
            size={17}
            color={theme.colors.accentText}
          />
        )}
        <Text style={styles.previewText}>Preview voice</Text>
      </Pressable>
      {!!speech.state.error && <Text style={styles.error}>{speech.state.error}</Text>}
      <Modal
        transparent
        visible={modelOpen}
        animationType="slide"
        onRequestClose={() => setModelOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setModelOpen(false)}>
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Choose a model</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {models.map((model) => (
                <Pressable
                  key={model.id}
                  onPress={() => {
                    const nextVoice = model.voices[0]?.id ?? "";
                    setVoices(model.voices);
                    void speech.updateSettings({
                      ...speech.settings,
                      model: model.id,
                      voice: nextVoice,
                    });
                    setModelOpen(false);
                  }}
                  style={styles.voiceRow}
                >
                  <View style={styles.modelCopy}>
                    <Text style={styles.voiceName}>{model.name}</Text>
                    <Text style={styles.modelDetail}>{model.voices.length} voices</Text>
                  </View>
                  {speech.settings.model === model.id && (
                    <Ionicons name="checkmark" size={20} color={theme.colors.accent} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        transparent
        visible={voiceOpen}
        animationType="slide"
        onRequestClose={() => setVoiceOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setVoiceOpen(false)}>
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Choose a voice</Text>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search voices"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
            />
            <ScrollView keyboardShouldPersistTaps="handled">
              {filteredVoices.map((voice) => (
                <Pressable
                  key={voice.id}
                  onPress={() => {
                    void speech.updateSettings({ ...speech.settings, voice: voice.id });
                    setVoiceOpen(false);
                    setSearch("");
                  }}
                  style={styles.voiceRow}
                >
                  <Text style={styles.voiceName}>{voice.name}</Text>
                  {speech.settings.voice === voice.id && (
                    <Ionicons name="checkmark" size={20} color={theme.colors.accent} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    root: {
      width: "100%",
      maxWidth: 680,
      alignSelf: "center",
      padding: theme.space.xl,
      paddingBottom: theme.space.huge,
    },
    sectionTitle: { color: theme.colors.text, fontSize: 21, fontWeight: "900" },
    sectionDescription: {
      color: theme.colors.textMuted,
      fontSize: 12,
      marginTop: theme.space.xs,
      marginBottom: theme.space.lg,
    },
    providerList: { gap: theme.space.sm },
    providerRow: {
      minHeight: 66,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      paddingHorizontal: theme.space.md,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      backgroundColor: theme.colors.surface,
    },
    providerRowSelected: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accentSurface,
    },
    providerIcon: { width: 28, alignItems: "center" },
    copy: { flex: 1 },
    providerName: { color: theme.colors.text, fontSize: 14, fontWeight: "800" },
    providerDetail: { color: theme.colors.textMuted, fontSize: 11, marginTop: theme.space.xs },
    warning: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      marginTop: theme.space.md,
      padding: theme.space.md,
      borderRadius: 12,
      backgroundColor: theme.colors.surface,
    },
    warningText: { flex: 1, color: theme.colors.warning, fontSize: 11, fontWeight: "700" },
    fieldLabel: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "900",
      letterSpacing: 1.1,
      marginTop: theme.space.xl,
      marginBottom: theme.space.sm,
    },
    selector: {
      height: 46,
      paddingHorizontal: theme.space.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderRadius: 12,
      backgroundColor: theme.colors.surface,
    },
    selectorText: { color: theme.colors.text, fontSize: 13, fontWeight: "700" },
    input: {
      minHeight: 44,
      paddingHorizontal: theme.space.md,
      borderRadius: 12,
      color: theme.colors.text,
      backgroundColor: theme.colors.surface,
    },
    instructionsInput: {
      minHeight: 104,
      paddingTop: theme.space.md,
      paddingBottom: theme.space.md,
      textAlignVertical: "top",
    },
    fieldHelp: {
      color: theme.colors.textMuted,
      fontSize: 11,
      lineHeight: 16,
      marginTop: theme.space.sm,
    },
    suggest: {
      minHeight: 42,
      marginTop: theme.space.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.space.sm,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
    },
    suggestText: { color: theme.colors.accent, fontSize: 12, fontWeight: "800" },
    speedRow: { flexDirection: "row", gap: theme.space.sm },
    speed: {
      flex: 1,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 11,
      backgroundColor: theme.colors.surface,
    },
    speedSelected: { backgroundColor: theme.colors.accent },
    speedText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: "800" },
    speedTextSelected: { color: theme.colors.accentText },
    preview: {
      height: 46,
      marginTop: theme.space.xl,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.space.sm,
      borderRadius: 13,
      backgroundColor: theme.colors.accent,
    },
    previewText: { color: theme.colors.accentText, fontSize: 13, fontWeight: "800" },
    disabled: { opacity: 0.35 },
    error: { color: theme.colors.danger, fontSize: 11, marginTop: theme.space.sm },
    backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
    sheet: {
      maxHeight: "78%",
      padding: theme.space.lg,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      backgroundColor: theme.colors.canvas,
    },
    handle: {
      width: 36,
      height: 4,
      alignSelf: "center",
      borderRadius: 2,
      marginBottom: theme.space.lg,
      backgroundColor: theme.colors.separatorStrong,
    },
    sheetTitle: {
      color: theme.colors.text,
      fontSize: 20,
      fontWeight: "900",
      marginBottom: theme.space.md,
    },
    voiceRow: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    modelCopy: { flex: 1 },
    modelDetail: { color: theme.colors.textMuted, fontSize: 10, marginTop: theme.space.xs },
    voiceName: { color: theme.colors.text, fontSize: 13, fontWeight: "700" },
  });
