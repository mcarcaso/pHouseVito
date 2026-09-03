import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { VoiceControlBar } from "../../components/voice/GlobalVoiceOverlay";
import { useAgentName } from "../../contexts/agentIdentity";
import { useVoiceSession } from "../../contexts/voice-session";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";

export function VoiceScreen({
  chatSessionId,
  onConfigureOpenAi,
}: {
  chatSessionId: string;
  onConfigureOpenAi?: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const agentName = useAgentName();
  const {
    active,
    available,
    error,
    transcript,
    status,
    controls,
    chatSessionId: activeChatSessionId,
    refreshConfiguration,
    start,
  } = useVoiceSession();
  const attemptedStartRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      void refreshConfiguration();
    }, [refreshConfiguration]),
  );

  useEffect(() => {
    if (attemptedStartRef.current || active || status.state !== "idle") return;
    attemptedStartRef.current = true;
    void start({ chatSessionId });
  }, [active, chatSessionId, start, status.state]);

  const belongsToAnotherChat = active && activeChatSessionId !== chatSessionId;

  return (
    <View style={styles.root}>
      {error && <Text style={styles.error}>{error}</Text>}
      {belongsToAnotherChat && (
        <Text style={styles.notice}>
          This is the voice conversation already active in another chat.
        </Text>
      )}
      {!active && available === false && (
        <View style={styles.unavailable}>
          <Ionicons name="mic-off-outline" size={34} color={theme.colors.textMuted} />
          <Text style={styles.unavailableTitle}>Live Voice is unavailable</Text>
          <Text style={styles.unavailableText}>
            Live conversations require a configured OpenAI or Google AI API key.
          </Text>
          {onConfigureOpenAi && (
            <Pressable onPress={onConfigureOpenAi} style={styles.configureButton}>
              <Text style={styles.configureButtonText}>Configure voice providers</Text>
            </Pressable>
          )}
        </View>
      )}
      <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent}>
        {available !== false && transcript.length === 0 && (
          <View style={styles.transcriptEmpty}>
            <Ionicons name="chatbubbles-outline" size={32} color={theme.colors.textMuted} />
            <Text style={styles.transcriptEmptyTitle}>Continue this conversation by voice</Text>
            <Text style={styles.transcriptEmptyText}>
              {agentName} has the recent user and assistant messages from this chat.
            </Text>
          </View>
        )}
        {transcript.map((line) => (
          <View key={line.id} style={styles.line}>
            <Text style={styles.role}>{line.role === "user" ? "You" : agentName}</Text>
            <Text style={styles.lineText}>{line.text}</Text>
          </View>
        ))}
      </ScrollView>
      {available !== false && (
        <View style={styles.embeddedControls}>
          <VoiceControlBar
            status={status}
            controls={controls}
            onStart={() => void start({ chatSessionId })}
          />
        </View>
      )}
    </View>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    root: { flex: 1, width: "100%", alignItems: "center" },
    unavailable: {
      width: "100%",
      maxWidth: 420,
      alignItems: "center",
      paddingHorizontal: theme.space.xl,
      paddingVertical: theme.space.xxxl,
    },
    unavailableTitle: {
      color: theme.colors.text,
      fontSize: 17,
      fontWeight: "800",
      marginTop: theme.space.md,
    },
    unavailableText: {
      color: theme.colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
      textAlign: "center",
      marginTop: theme.space.sm,
    },
    configureButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: 12,
      paddingHorizontal: theme.space.xl,
      paddingVertical: theme.space.md,
      marginTop: theme.space.xl,
    },
    configureButtonText: { color: theme.colors.accentText, fontSize: 13, fontWeight: "800" },
    error: {
      color: theme.colors.danger,
      fontSize: 12,
      lineHeight: 17,
      textAlign: "center",
      marginTop: theme.space.md,
      maxWidth: 340,
    },
    notice: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 18,
      textAlign: "center",
      marginTop: theme.space.md,
      paddingHorizontal: theme.space.xl,
    },
    transcript: { flex: 1, width: "100%" },
    transcriptContent: { flexGrow: 1, paddingVertical: theme.space.lg, gap: theme.space.md },
    transcriptEmpty: {
      flex: 1,
      minHeight: 320,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.space.xxl,
    },
    transcriptEmptyTitle: {
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "800",
      marginTop: theme.space.md,
      textAlign: "center",
    },
    transcriptEmptyText: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 18,
      textAlign: "center",
      marginTop: theme.space.sm,
    },
    embeddedControls: { width: "100%", paddingTop: theme.space.sm },
    line: { gap: theme.space.xs },
    role: { color: theme.colors.accent, fontSize: 10, fontWeight: "800" },
    lineText: { color: theme.colors.text, fontSize: 15, lineHeight: 22 },
  });
