import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { VoiceControlBar } from "../../components/voice/GlobalVoiceOverlay";
import { useAgentName } from "../../contexts/agentIdentity";
import { useVoiceSession } from "../../contexts/voice-session";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";
import {
  getVoiceSession,
  getVoiceSessions,
  type VoiceSession,
  type VoiceSessionDetail,
} from "../../services/api/client";

export function VoiceScreen({ onConfigureOpenAi }: { onConfigureOpenAi?: () => void }) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const agentName = useAgentName();
  const { active, available, error, transcript, status, controls, refreshConfiguration, start } =
    useVoiceSession();
  const [history, setHistory] = useState<VoiceSession[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<VoiceSessionDetail | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await getVoiceSessions());
    } catch {
      // Voice history is secondary to the live connection.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshConfiguration();
      void loadHistory();
    }, [loadHistory, refreshConfiguration]),
  );

  const openHistory = useCallback(async (id: string) => {
    const detail = await getVoiceSession(id);
    if (detail) setSelectedHistory(detail);
  }, []);

  const historySummary = useMemo(() => {
    if (!selectedHistory) return null;
    const seconds = selectedHistory.durationMs
      ? Math.round(selectedHistory.durationMs / 1_000)
      : null;
    const tokens = selectedHistory.usage.reduce<number>((total, usage) => {
      if (!usage || typeof usage !== "object" || !("total_tokens" in usage)) return total;
      const value = (usage as { total_tokens?: unknown }).total_tokens;
      return total + (typeof value === "number" ? value : 0);
    }, 0);
    return [
      seconds === null ? null : `${seconds}s`,
      tokens > 0
        ? `${tokens.toLocaleString()} tokens`
        : `${selectedHistory.usage.length} usage record(s)`,
    ]
      .filter(Boolean)
      .join(" · ");
  }, [selectedHistory]);

  const displayedTranscript = useMemo(() => {
    if (active || !selectedHistory) return transcript;
    return selectedHistory.messages
      .filter((message) => message.type === "user" || message.type === "assistant")
      .map((message) => ({
        id: message.id,
        role: message.type === "user" ? ("user" as const) : ("agent" as const),
        text: message.content,
      }));
  }, [active, selectedHistory, transcript]);

  const returnToHistory = () => {
    setSelectedHistory(null);
    setShowHistory(true);
  };

  const resumeHistory = async () => {
    if (!selectedHistory) return;
    const detail = selectedHistory;
    setSelectedHistory(null);
    setShowHistory(false);
    await start(detail);
  };

  return (
    <View style={styles.root}>
      {error && <Text style={styles.error}>{error}</Text>}
      {!active && available === false && !selectedHistory && (
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
      {!active && selectedHistory && (
        <Pressable onPress={returnToHistory} style={styles.historyButton}>
          <Text style={styles.historyButtonText}>‹ Past conversations</Text>
        </Pressable>
      )}
      {!active && selectedHistory && (
        <Pressable onPress={() => void resumeHistory()} style={styles.resumeButton}>
          <Text style={styles.resumeButtonText}>Resume conversation</Text>
        </Pressable>
      )}
      <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent}>
        {available !== false &&
          !showHistory &&
          !selectedHistory &&
          displayedTranscript.length === 0 && (
            <View style={styles.transcriptEmpty}>
              <Ionicons name="chatbubbles-outline" size={32} color={theme.colors.textMuted} />
              <Text style={styles.transcriptEmptyTitle}>Your transcript will appear here</Text>
              <Text style={styles.transcriptEmptyText}>
                Start a conversation to see what you and {agentName} say.
              </Text>
            </View>
          )}
        {!active && showHistory && !selectedHistory && history.length > 0 && (
          <View style={styles.historyBlock}>
            <Text style={styles.historyTitle}>RECENT CONVERSATIONS</Text>
            {history.slice(0, 8).map((session) => (
              <Pressable
                key={session.id}
                onPress={() => void openHistory(session.id)}
                style={styles.historyListRow}
              >
                <View style={styles.historyListCopy}>
                  <Text style={styles.historyListTitle} numberOfLines={1}>
                    {session.alias?.startsWith("Voice —")
                      ? "Voice conversation"
                      : (session.alias ?? "Voice conversation")}
                  </Text>
                  <Text style={styles.historyTime}>
                    {new Date(session.created_at).toLocaleDateString()} ·{" "}
                    {new Date(session.created_at).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Text>
                </View>
                <Text style={styles.historyChevron}>›</Text>
              </Pressable>
            ))}
          </View>
        )}
        {!active && selectedHistory && historySummary && (
          <Text style={styles.summary}>{historySummary}</Text>
        )}
        {displayedTranscript.map((line) => (
          <View key={line.id} style={styles.line}>
            <Text style={styles.role}>{line.role === "user" ? "You" : agentName}</Text>
            <Text style={styles.lineText}>{line.text}</Text>
          </View>
        ))}
      </ScrollView>
      {available !== false && !selectedHistory && !showHistory && (
        <View style={styles.embeddedControls}>
          <VoiceControlBar status={status} controls={controls} onStart={() => void start(null)} />
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
    historyButton: {
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: theme.space.xl,
      marginBottom: theme.space.md,
    },
    historyButtonText: { color: theme.colors.accent, fontSize: 13, fontWeight: "800" },
    resumeButton: {
      backgroundColor: theme.colors.accent,
      borderRadius: 12,
      paddingHorizontal: theme.space.xl,
      paddingVertical: theme.space.md,
      marginTop: theme.space.lg,
    },
    resumeButtonText: { color: theme.colors.accentText, fontSize: 13, fontWeight: "800" },
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
    },
    transcriptEmptyText: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 18,
      textAlign: "center",
      marginTop: theme.space.sm,
    },
    embeddedControls: { width: "100%", paddingTop: theme.space.sm },
    historyBlock: { gap: theme.space.md, marginBottom: theme.space.xs },
    historyTitle: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 1.2,
    },
    historyListRow: {
      minHeight: 62,
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
      paddingVertical: theme.space.md,
    },
    historyListCopy: { flex: 1, minWidth: 0 },
    historyListTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "700" },
    historyTime: { color: theme.colors.textMuted, fontSize: 11, marginTop: theme.space.xs },
    historyChevron: { color: theme.colors.textMuted, fontSize: 24 },
    summary: { color: theme.colors.textSecondary, fontSize: 11, textAlign: "center" },
    line: {
      padding: theme.space.lg,
      borderRadius: 14,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separator,
    },
    role: {
      color: theme.colors.accent,
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 1.2,
      marginBottom: theme.space.xs,
      textTransform: "uppercase",
    },
    lineText: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20 },
  });
