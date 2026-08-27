import type { VitoTheme } from "../../hooks/useVitoTheme";
import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useThemeStyles, useVitoTheme } from "../../hooks/useVitoTheme";

export function WebStackHeader({
  onBack,
  onSearch,
  title,
  right,
}: {
  onBack?: () => void;
  onSearch?: (query: string) => void;
  title?: string;
  right?: ReactNode;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [query, setQuery] = useState("");
  return (
    <View style={styles.webStackHeader}>
      {onBack && (
        <Pressable accessibilityLabel="Back" onPress={onBack} style={styles.webBackButton}>
          <Ionicons name="chevron-back" size={24} color={theme.colors.accent} />
        </Pressable>
      )}
      {title && <Text style={styles.webHeaderTitle}>{title}</Text>}
      {onSearch && (
        <View style={styles.webHeaderSearch}>
          <Ionicons name="search-outline" size={17} color={theme.colors.accent} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => {
              const value = query.trim();
              if (value) onSearch(value);
            }}
            placeholder="Search memory"
            placeholderTextColor={theme.colors.textMuted}
            returnKeyType="search"
            style={styles.webHeaderSearchInput}
          />
        </View>
      )}
      {right && <View style={styles.webHeaderRight}>{right}</View>}
    </View>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    webStackHeader: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      paddingHorizontal: theme.space.xl,
      backgroundColor: theme.colors.canvas,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    webBackButton: {
      width: 36,
      height: 44,
      alignItems: "flex-start",
      justifyContent: "center",
    },
    webHeaderTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
    webHeaderSearch: {
      flex: 1,
      maxWidth: 820,
      height: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separatorStrong,
    },
    webHeaderSearchInput: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 15,
      paddingVertical: theme.space.md,
    },
    webHeaderRight: {
      marginLeft: "auto",
      flexDirection: "row",
      alignItems: "center",
    },
  });
