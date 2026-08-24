import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { createAppStyles } from "../../application/styles";
import { DESKTOP_BREAKPOINT, useThemeStyles, useVitoTheme } from "../../hooks/useVitoTheme";
import type { VoiceOverlayStatus } from "../../screens/voice/VoiceScreen";

export function GlobalVoiceOverlay({
  status,
  onPress,
}: {
  status: VoiceOverlayStatus;
  onPress: () => void;
}) {
  const styles = useThemeStyles(createAppStyles);
  const theme = useVitoTheme();
  const desktop = useWindowDimensions().width >= DESKTOP_BREAKPOINT;
  const taskLabel =
    status.completedTasks > 0
      ? `${status.completedTasks} task${status.completedTasks === 1 ? "" : "s"} ready`
      : status.failedTasks > 0
        ? `${status.failedTasks} task${status.failedTasks === 1 ? "" : "s"} failed`
        : status.runningTasks > 0
          ? `${status.runningTasks} task${status.runningTasks === 1 ? "" : "s"} working`
          : null;
  const voiceLabel =
    status.state === "connecting"
      ? "Connecting"
      : status.muted
        ? "Voice muted"
        : status.state === "speaking"
          ? "Vito is speaking"
          : "Vito is listening";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${voiceLabel}${taskLabel ? `, ${taskLabel}` : ""}. Open voice.`}
      onPress={onPress}
      style={[styles.voiceOverlay, desktop && styles.voiceOverlayDesktop]}
    >
      <View style={[styles.voicePulse, status.state === "speaking" && styles.voicePulseSpeaking]}>
        <Ionicons
          name={status.muted ? "mic-off" : status.state === "speaking" ? "volume-high" : "mic"}
          size={16}
          color={theme.colors.accentText}
        />
      </View>
      <View style={styles.voiceOverlayCopy}>
        <Text style={styles.voiceOverlayTitle}>{voiceLabel}</Text>
        <Text style={styles.voiceOverlayDetail}>
          {taskLabel ?? "Tap for transcript and controls"}
        </Text>
      </View>
      {status.completedTasks > 0 && <View style={styles.voiceReadyDot} />}
      <Ionicons name="chevron-up" size={17} color={theme.colors.textMuted} />
    </Pressable>
  );
}
