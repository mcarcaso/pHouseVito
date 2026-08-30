import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  GEMINI_LIVE_VOICES,
  getConfiguredSecretKeys,
  loadGeminiLiveVoice,
  loadLiveVoiceProvider,
  loadRealtimeModel,
  loadRealtimeVoice,
  REALTIME_VOICES,
  saveGeminiLiveVoice,
  saveLiveVoiceProvider,
  saveRealtimeModel,
  saveRealtimeVoice,
  type GeminiLiveVoice,
  type LiveVoiceProviderPreference,
  type RealtimeModel,
  type RealtimeVoice,
  type VoiceAvailability,
} from "../../services/api/client";
import { useThemeStyles, type VitoTheme } from "../../hooks/useVitoTheme";
import { VoicePreviewLinks } from "./VoicePreviewLinks";

const models: Array<{ id: RealtimeModel; name: string; detail: string }> = [
  {
    id: "gpt-realtime-mini",
    name: "Light",
    detail: "Faster and more economical",
  },
  {
    id: "gpt-realtime",
    name: "Full",
    detail: "Higher quality and capability",
  },
];

export function VoiceModeSettingsScreen() {
  const styles = useThemeStyles(createStyles);
  const [provider, setProvider] = useState<LiveVoiceProviderPreference>("auto");
  const [availability, setAvailability] = useState<VoiceAvailability | null>(null);
  const [model, setModel] = useState<RealtimeModel>("gpt-realtime-mini");
  const [voice, setVoice] = useState<RealtimeVoice>("marin");
  const [geminiVoice, setGeminiVoice] = useState<GeminiLiveVoice>("Kore");

  useEffect(() => {
    void loadLiveVoiceProvider().then(setProvider);
    void getConfiguredSecretKeys()
      .then((keys) => {
        const providers = {
          openai: keys.has("OPENAI_API_KEY"),
          gemini: keys.has("GOOGLE_GENERATIVE_AI_API_KEY"),
        };
        const configuredProvider = providers.gemini
          ? ("gemini" as const)
          : providers.openai
            ? ("openai" as const)
            : null;
        setAvailability({
          available: configuredProvider !== null,
          provider: configuredProvider,
          reason: configuredProvider ? null : "Live Voice requires an OpenAI or Google AI API key.",
          providers,
        });
      })
      .catch(() => undefined);
    void loadRealtimeModel().then(setModel);
    void loadRealtimeVoice().then(setVoice);
    void loadGeminiLiveVoice().then(setGeminiVoice);
  }, []);

  const activeProvider = provider === "auto" ? (availability?.provider ?? "gemini") : provider;
  const providerOptions: Array<{
    id: LiveVoiceProviderPreference;
    name: string;
    detail: string;
    icon: React.ComponentProps<typeof Ionicons>["name"];
    available: boolean;
  }> = [
    {
      id: "auto",
      name: "Automatic",
      detail: `Gemini first, then OpenAI${availability?.provider ? ` · using ${availability.provider}` : ""}`,
      icon: "git-compare-outline",
      available: availability?.available ?? true,
    },
    {
      id: "openai",
      name: "OpenAI",
      detail: "Realtime over WebRTC",
      icon: "sparkles-outline",
      available: availability?.providers.openai ?? true,
    },
    {
      id: "gemini",
      name: "Gemini",
      detail: "Gemini Live over WebSocket",
      icon: "logo-google",
      available: availability?.providers.gemini ?? true,
    },
  ];

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.sectionTitle}>Provider</Text>
      <View style={styles.providerList}>
        {providerOptions.map((option) => (
          <Pressable
            key={option.id}
            disabled={!option.available}
            onPress={() => {
              setProvider(option.id);
              void saveLiveVoiceProvider(option.id);
            }}
            style={[
              styles.providerRow,
              provider === option.id && styles.selectedRow,
              !option.available && styles.unavailable,
            ]}
          >
            <View style={styles.providerIcon}>
              <Ionicons name={option.icon} size={19} style={styles.icon} />
            </View>
            <View style={styles.copy}>
              <Text style={styles.optionTitle}>{option.name}</Text>
              <Text style={styles.optionDetail}>
                {option.available ? option.detail : `${option.detail} · API key required`}
              </Text>
            </View>
            {provider === option.id && (
              <Ionicons name="checkmark-circle" size={21} style={styles.selectedIcon} />
            )}
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Model</Text>
      {activeProvider === "openai" ? (
        <View style={styles.optionList}>
          {models.map((option) => (
            <Pressable
              key={option.id}
              onPress={() => {
                setModel(option.id);
                void saveRealtimeModel(option.id);
              }}
              style={[styles.optionRow, model === option.id && styles.selectedRow]}
            >
              <View style={styles.copy}>
                <Text style={styles.optionTitle}>{option.name}</Text>
                <Text style={styles.optionDetail}>{option.detail}</Text>
              </View>
              {model === option.id && (
                <Ionicons name="checkmark" size={20} style={styles.selectedIcon} />
              )}
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={[styles.providerRow, styles.selectedRow]}>
          <View style={styles.copy}>
            <Text style={styles.optionTitle}>Gemini 3.1 Flash Live</Text>
            <Text style={styles.optionDetail}>Native audio preview</Text>
          </View>
          <Ionicons name="checkmark" size={20} style={styles.selectedIcon} />
        </View>
      )}

      <Text style={styles.sectionTitle}>Voice</Text>
      <VoicePreviewLinks providers={[activeProvider]} />
      <View style={styles.voiceGrid}>
        {activeProvider === "openai"
          ? REALTIME_VOICES.map((option) => (
              <View
                key={option}
                style={[styles.voiceOption, voice === option && styles.voiceOptionSelected]}
              >
                <Pressable
                  onPress={() => {
                    setVoice(option);
                    void saveRealtimeVoice(option);
                  }}
                  style={styles.voiceSelect}
                >
                  <Text style={[styles.voiceText, voice === option && styles.voiceTextSelected]}>
                    {option[0].toUpperCase() + option.slice(1)}
                  </Text>
                  {voice === option && (
                    <Ionicons name="checkmark" size={16} style={styles.selectedIcon} />
                  )}
                </Pressable>
              </View>
            ))
          : GEMINI_LIVE_VOICES.map((option) => (
              <View
                key={option}
                style={[styles.voiceOption, geminiVoice === option && styles.voiceOptionSelected]}
              >
                <Pressable
                  onPress={() => {
                    setGeminiVoice(option);
                    void saveGeminiLiveVoice(option);
                  }}
                  style={styles.voiceSelect}
                >
                  <Text
                    style={[styles.voiceText, geminiVoice === option && styles.voiceTextSelected]}
                  >
                    {option}
                  </Text>
                  {geminiVoice === option && (
                    <Ionicons name="checkmark" size={16} style={styles.selectedIcon} />
                  )}
                </Pressable>
              </View>
            ))}
      </View>
      <Text style={styles.footnote}>Changes apply the next time you start Voice Mode.</Text>
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
      paddingBottom: theme.space.giant,
    },
    sectionTitle: {
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: "900",
      letterSpacing: 1.1,
      textTransform: "uppercase",
      marginTop: theme.space.lg,
      marginBottom: theme.space.sm,
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
    providerIcon: { width: 28, alignItems: "center" },
    icon: { color: theme.colors.accent },
    copy: { flex: 1 },
    optionTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "800" },
    optionDetail: { color: theme.colors.textMuted, fontSize: 11, marginTop: theme.space.xs },
    selectedIcon: { color: theme.colors.accent },
    optionList: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.separator,
    },
    optionRow: {
      minHeight: 62,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: theme.space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    selectedRow: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSurface },
    unavailable: { opacity: 0.45 },
    voiceGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
    voiceOption: {
      width: "31%",
      minWidth: 120,
      flexGrow: 1,
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderRadius: 11,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      backgroundColor: theme.colors.surface,
    },
    voiceOptionSelected: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accentSurface,
    },
    voiceSelect: {
      flex: 1,
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingLeft: theme.space.md,
      paddingRight: theme.space.sm,
    },
    voiceText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: "700" },
    voiceTextSelected: { color: theme.colors.accent },
    footnote: { color: theme.colors.textMuted, fontSize: 11, marginTop: theme.space.lg },
  });
