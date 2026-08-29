import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";
import { api } from "../../services/api/client";

export type BackfillStatus = {
  active: boolean;
  pid: number | null;
  startedAt: number | null;
  totalChunks: number;
  completedChunks: number;
  pendingChunks: number;
  processingChunks: number;
  failedChunks: number;
  totalFacts: number;
  embeddedFacts: number;
  percent: number;
};

export function MemoryAdvancedSheet({
  visible,
  onClose,
  onUnauthorized,
}: {
  visible: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [status, setStatus] = useState<BackfillStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!visible) return;
    try {
      setStatus(await api<BackfillStatus>("/api/memory/facts/backfill/status"));
      setError(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not load backfill status";
      if (message.toLowerCase().includes("unauthorized")) onUnauthorized();
      setError(message);
    }
  }, [onUnauthorized, visible]);

  useEffect(() => {
    if (!visible) return;
    void refresh();
    const timer = setInterval(() => void refresh(), status?.active ? 2_000 : 10_000);
    return () => clearInterval(timer);
  }, [refresh, status?.active, visible]);

  const start = () => {
    Alert.alert(
      "Backfill historical facts?",
      "This processes past transcript chunks with the configured fact model and may incur model usage costs.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Start Backfill",
          onPress: async () => {
            setLoading(true);
            try {
              await api("/api/memory/facts/backfill/start", {
                method: "POST",
                body: JSON.stringify({}),
              });
              setTimeout(() => void refresh(), 750);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Could not start backfill");
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  const stop = () => {
    Alert.alert("Stop backfill?", "Completed facts remain available. You can resume later.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Stop",
        style: "destructive",
        onPress: async () => {
          setLoading(true);
          try {
            await api("/api/memory/facts/backfill/stop", {
              method: "POST",
              body: JSON.stringify({}),
            });
            setTimeout(() => void refresh(), 750);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not stop backfill");
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>Memory Backfill</Text>
          <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={23} color={theme.colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.content}>
          <Text style={styles.explanation}>
            New conversations are ingested automatically. Historical backfill is optional and can be
            paused or resumed without losing completed work.
          </Text>

          {!status && !error && <ActivityIndicator color={theme.colors.accent} />}
          {error && <Text style={styles.error}>{error}</Text>}
          {status && (
            <>
              <View style={styles.statusRow}>
                <View style={[styles.dot, status.active && styles.dotActive]} />
                <Text style={styles.statusText}>
                  {status.active ? "Backfill running" : "Not running"}
                </Text>
                <Text style={styles.percent}>{status.percent.toFixed(1)}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${status.percent}%` }]} />
              </View>

              <View style={styles.metrics}>
                <Metric
                  label="Chunks complete"
                  value={`${status.completedChunks} / ${status.totalChunks}`}
                  styles={styles}
                />
                <Metric
                  label="Chunks remaining"
                  value={String(status.pendingChunks)}
                  styles={styles}
                />
                <Metric label="Facts" value={String(status.totalFacts)} styles={styles} />
                <Metric
                  label="Facts embedded"
                  value={String(status.embeddedFacts)}
                  styles={styles}
                />
                <Metric
                  label="Processing speed"
                  value={status.active ? "1 chunk at a time" : "Stopped"}
                  styles={styles}
                />
                <Metric
                  label="Exhausted failures"
                  value={String(status.failedChunks)}
                  styles={styles}
                />
              </View>

              <Pressable
                disabled={loading}
                onPress={status.active ? stop : start}
                style={({ pressed }) => [
                  styles.action,
                  status.active && styles.stopAction,
                  pressed && styles.pressed,
                ]}
              >
                {loading ? (
                  <ActivityIndicator
                    color={status.active ? theme.colors.danger : theme.colors.accentText}
                  />
                ) : (
                  <Text style={[styles.actionText, status.active && styles.stopText]}>
                    {status.active ? "Stop Backfill" : "Start Full Backfill"}
                  </Text>
                )}
              </Pressable>
              <Pressable onPress={() => void refresh()} style={styles.refresh}>
                <Ionicons name="refresh" size={16} color={theme.colors.accent} />
                <Text style={styles.refreshText}>Refresh status</Text>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function Metric({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function createStyles(theme: VitoTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.canvas },
    header: {
      minHeight: 54,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.space.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    title: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
    closeButton: { padding: theme.space.sm },
    content: { width: "100%", maxWidth: 620, alignSelf: "center", padding: theme.space.xl },
    explanation: {
      color: theme.colors.textSecondary,
      fontSize: 14,
      lineHeight: 21,
      marginBottom: theme.space.xxl,
    },
    error: { color: theme.colors.danger, marginBottom: theme.space.lg },
    statusRow: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
    dot: {
      width: 9,
      height: 9,
      borderRadius: theme.radius.round,
      backgroundColor: theme.colors.textMuted,
    },
    dotActive: { backgroundColor: theme.colors.success },
    statusText: { flex: 1, color: theme.colors.text, fontSize: 15, fontWeight: "600" },
    percent: { color: theme.colors.textSecondary, fontFamily: "monospace", fontSize: 13 },
    progressTrack: {
      height: 5,
      backgroundColor: theme.colors.surfaceRaised,
      marginTop: theme.space.md,
      overflow: "hidden",
    },
    progressFill: { height: "100%", backgroundColor: theme.colors.accent },
    metrics: {
      marginTop: theme.space.xxl,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.separator,
    },
    metricRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: theme.space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    metricLabel: { color: theme.colors.textSecondary, fontSize: 13 },
    metricValue: { color: theme.colors.text, fontFamily: "monospace", fontSize: 13 },
    action: {
      minHeight: 46,
      alignItems: "center",
      justifyContent: "center",
      marginTop: theme.space.xxl,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.accent,
    },
    stopAction: {
      backgroundColor: theme.colors.dangerSurface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.danger,
    },
    actionText: { color: theme.colors.accentText, fontSize: 14, fontWeight: "700" },
    stopText: { color: theme.colors.danger },
    pressed: { opacity: 0.7 },
    refresh: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.space.sm,
      paddingVertical: theme.space.lg,
    },
    refreshText: { color: theme.colors.accent, fontSize: 13 },
  });
}
