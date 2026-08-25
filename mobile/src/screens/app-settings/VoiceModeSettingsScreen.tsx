import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  loadRealtimeModel,
  loadRealtimeVoice,
  REALTIME_VOICES,
  saveRealtimeModel,
  saveRealtimeVoice,
  type RealtimeModel,
  type RealtimeVoice,
} from "../../services/api/client";
import { useThemeStyles, type VitoTheme } from "../../hooks/useVitoTheme";

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
  const [model, setModel] = useState<RealtimeModel>("gpt-realtime-mini");
  const [voice, setVoice] = useState<RealtimeVoice>("marin");

  useEffect(() => {
    void loadRealtimeModel().then(setModel);
    void loadRealtimeVoice().then(setVoice);
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.sectionTitle}>Provider</Text>
      <View style={[styles.providerRow, styles.selectedRow]}>
        <View style={styles.providerIcon}>
          <Ionicons name="sparkles-outline" size={19} style={styles.icon} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.optionTitle}>OpenAI</Text>
          <Text style={styles.optionDetail}>Realtime voice conversations</Text>
        </View>
        <Ionicons name="checkmark-circle" size={21} style={styles.selectedIcon} />
      </View>

      <Text style={styles.sectionTitle}>Model</Text>
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

      <Text style={styles.sectionTitle}>Voice</Text>
      <View style={styles.voiceGrid}>
        {REALTIME_VOICES.map((option) => (
          <Pressable
            key={option}
            onPress={() => {
              setVoice(option);
              void saveRealtimeVoice(option);
            }}
            style={[styles.voiceOption, voice === option && styles.voiceOptionSelected]}
          >
            <Text style={[styles.voiceText, voice === option && styles.voiceTextSelected]}>
              {option[0].toUpperCase() + option.slice(1)}
            </Text>
            {voice === option && (
              <Ionicons name="checkmark" size={16} style={styles.selectedIcon} />
            )}
          </Pressable>
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
    voiceGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
    voiceOption: {
      width: "31%",
      minWidth: 120,
      flexGrow: 1,
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.space.md,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      backgroundColor: theme.colors.surface,
    },
    voiceOptionSelected: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accentSurface,
    },
    voiceText: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: "700" },
    voiceTextSelected: { color: theme.colors.accent },
    footnote: { color: theme.colors.textMuted, fontSize: 11, marginTop: theme.space.lg },
  });
