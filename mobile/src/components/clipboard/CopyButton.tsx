import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <Pressable
      hitSlop={7}
      accessibilityRole="button"
      accessibilityLabel={copied ? "Copied" : label}
      style={styles.button}
      onPress={() => {
        void Clipboard.setStringAsync(text)
          .then(() => {
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => setCopied(false));
      }}
    >
      <Ionicons
        name={copied ? "checkmark" : "copy-outline"}
        size={16}
        color={theme.colors.textMuted}
      />
    </Pressable>
  );
}
const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    button: {
      alignSelf: "flex-end",
      width: 30,
      height: 30,
      marginTop: theme.space.xxs,
      backgroundColor: theme.colors.surfaceRaised,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.radius.round,
    },
  });
