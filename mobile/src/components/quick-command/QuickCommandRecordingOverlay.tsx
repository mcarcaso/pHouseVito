import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { QuickCommandRecordingStatus } from "../../screens/home/HomeScreen";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";

export function QuickCommandRecordingOverlay({
  status,
  onOpen,
}: {
  status: QuickCommandRecordingStatus;
  onOpen: () => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const seconds = Math.floor(status.durationMs / 1000);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <View
      style={[
        styles.overlay,
        keyboardVisible ? { top: insets.top + 52 } : styles.overlayBottom,
      ]}
    >
      <Pressable accessibilityLabel="Open Quick Command" onPress={onOpen} style={styles.status}>
        <View style={styles.pulse}>
          <Ionicons name="mic" size={17} color={theme.colors.accentText} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>Recording command</Text>
          <Text style={styles.detail}>
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel="Stop and send Quick Command"
        onPress={status.stop}
        style={styles.stop}
      >
        <Ionicons name="stop" size={18} color="#fff" />
      </Pressable>
    </View>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    overlay: {
      position: "absolute",
      left: theme.space.md,
      right: theme.space.md,
      minHeight: 58,
      paddingHorizontal: theme.space.sm,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      borderRadius: 18,
      backgroundColor: theme.colors.surfaceRaised,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
      shadowColor: "#000",
      shadowOpacity: 0.24,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
      zIndex: 101,
    },
    overlayBottom: { bottom: 88 },
    status: {
      flex: 1,
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      paddingLeft: theme.space.xs,
    },
    pulse: {
      width: 34,
      height: 34,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.accent,
    },
    copy: { flex: 1 },
    title: { color: theme.colors.text, fontSize: 12, fontWeight: "800" },
    detail: {
      color: theme.colors.textMuted,
      fontSize: 10,
      marginTop: theme.space.xs,
      fontVariant: ["tabular-nums"],
    },
    stop: {
      width: 40,
      height: 40,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.danger,
    },
  });
