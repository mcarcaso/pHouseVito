import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useAgentName } from "../../contexts/agentIdentity";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";
import type { VoiceOverlayControls, VoiceOverlayStatus } from "../../screens/voice/VoiceScreen";

export function VoiceControlBar({
  status,
  controls,
  onPress,
  onStart,
  onHistory,
}: {
  status: VoiceOverlayStatus;
  controls: VoiceOverlayControls | null;
  onPress?: () => void;
  onStart?: () => void;
  onHistory?: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const agentName = useAgentName();
  const active = status.state !== "idle" && status.state !== "error";
  const label = active
    ? status.state === "connecting"
      ? "Connecting"
      : status.muted
        ? "Muted"
        : status.state === "speaking"
          ? `${agentName} speaking`
          : "Listening"
    : "Start a conversation";
  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityLabel={active ? `${label}. Open transcript.` : label}
        onPress={active ? onPress : onStart}
        style={styles.status}
      >
        <View style={[styles.pulse, active && styles.pulseActive]}>
          <Ionicons
            name={active ? (status.state === "speaking" ? "volume-high" : "mic") : "mic-outline"}
            size={17}
            color={active ? theme.colors.accentText : theme.colors.accent}
          />
        </View>
        <Text numberOfLines={1} style={styles.statusText}>
          {label}
        </Text>
      </Pressable>
      {!active && onHistory && (
        <Pressable
          accessibilityLabel="Past conversations"
          onPress={onHistory}
          style={styles.control}
        >
          <Ionicons name="time-outline" size={21} color={theme.colors.textSecondary} />
        </Pressable>
      )}
      {active && controls && (
        <>
          <Pressable
            accessibilityLabel={status.muted ? "Unmute" : "Mute"}
            onPress={controls.toggleMute}
            style={styles.control}
          >
            <Ionicons
              name={status.muted ? "mic-off" : "mic"}
              size={20}
              color={status.muted ? theme.colors.danger : theme.colors.text}
            />
          </Pressable>
          {Platform.OS !== "web" && (
            <Pressable
              accessibilityLabel={`Audio output: ${status.audioRoute}`}
              onPress={controls.toggleAudioRoute}
              style={styles.control}
            >
              <Ionicons
                name={status.audioRoute === "speaker" ? "volume-high" : "ear-outline"}
                size={20}
                color={theme.colors.text}
              />
            </Pressable>
          )}
          <Pressable
            accessibilityLabel={`${status.runningTasks} active tasks`}
            onPress={onPress}
            style={styles.control}
          >
            <Ionicons
              name="sparkles-outline"
              size={19}
              color={status.runningTasks ? theme.colors.accent : theme.colors.textMuted}
            />
            {!!status.runningTasks && (
              <View style={styles.taskBadge}>
                <Text style={styles.taskBadgeText}>{status.runningTasks}</Text>
              </View>
            )}
          </Pressable>
          <Pressable
            accessibilityLabel="Hang up"
            onPress={controls.hangUp}
            style={[styles.control, styles.hangUp]}
          >
            <Ionicons name="call" size={20} color="#fff" style={styles.hangUpIcon} />
          </Pressable>
        </>
      )}
    </View>
  );
}

export function GlobalVoiceOverlay({
  status,
  controls,
  onPress,
}: {
  status: VoiceOverlayStatus;
  controls: VoiceOverlayControls;
  onPress: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <View style={styles.overlay}>
      <VoiceControlBar status={status} controls={controls} onPress={onPress} />
    </View>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    overlay: {
      position: "absolute",
      left: theme.space.md,
      right: theme.space.md,
      bottom: 78,
      zIndex: 100,
      shadowColor: "#000",
      shadowOpacity: 0.24,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
    },
    bar: {
      minHeight: 58,
      paddingHorizontal: theme.space.sm,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.xs,
      borderRadius: 18,
      backgroundColor: theme.colors.surfaceRaised,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
    },
    status: {
      flex: 1,
      minWidth: 0,
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      paddingLeft: theme.space.xs,
    },
    pulse: {
      width: 32,
      height: 32,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.colors.accent,
    },
    pulseActive: { borderWidth: 0, backgroundColor: theme.colors.accent },
    statusText: { flex: 1, color: theme.colors.text, fontSize: 12, fontWeight: "800" },
    control: {
      width: 40,
      height: 40,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
    },
    hangUp: { backgroundColor: theme.colors.danger },
    hangUpIcon: { transform: [{ rotate: "135deg" }] },
    taskBadge: {
      position: "absolute",
      top: 1,
      right: 1,
      minWidth: 15,
      height: 15,
      paddingHorizontal: theme.space.xs,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.accent,
    },
    taskBadgeText: { color: theme.colors.accentText, fontSize: 9, fontWeight: "900" },
  });
