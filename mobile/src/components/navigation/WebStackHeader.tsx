import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { createAppStyles } from "../../application/styles";
import { useThemeStyles, useVitoTheme } from "../../hooks/useVitoTheme";

export function WebStackHeader({
  onBack,
  onSearch,
  title,
  right,
}: {
  onBack: () => void;
  onSearch?: (query: string) => void;
  title?: string;
  right?: ReactNode;
}) {
  const styles = useThemeStyles(createAppStyles);
  const theme = useVitoTheme();
  const [query, setQuery] = useState("");
  return (
    <View style={styles.webStackHeader}>
      <Pressable accessibilityLabel="Back" onPress={onBack} style={styles.webBackButton}>
        <Ionicons name="chevron-back" size={24} color={theme.colors.accent} />
      </Pressable>
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
      {right}
    </View>
  );
}
