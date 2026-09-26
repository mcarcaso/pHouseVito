import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  paletteNames,
  themes,
  useThemeStyles,
  useVitoThemeController,
  type ThemeAppearance,
  type VitoTheme,
} from "../../hooks/useVitoTheme";

export function ThemeScreen() {
  const styles = useThemeStyles(createStyles);
  const { themeName, setThemeName, appearance, setAppearance } = useVitoThemeController();
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Appearance</Text>
      <View style={styles.modeRow} accessibilityRole="radiogroup">
        {(["light", "dark", "system"] as const).map((mode: ThemeAppearance) => (
          <Pressable
            key={mode}
            accessibilityRole="radio"
            accessibilityLabel={`${mode} appearance`}
            accessibilityState={{ checked: appearance === mode }}
            onPress={() => setAppearance(mode)}
            style={[styles.modeChoice, appearance === mode && styles.modeActive]}
          >
            <Text style={[styles.modeText, appearance === mode && styles.modeTextActive]}>
              {mode === "system" ? "System" : mode === "light" ? "Light" : "Dark"}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.intro}>System follows this device’s appearance setting.</Text>
      <Text style={styles.heading}>Color palette</Text>
      <Text style={styles.intro}>Each palette has a light and a dark version.</Text>
      <View style={styles.grid}>
        {paletteNames.map((name) => (
          <Pressable
            key={name}
            accessibilityRole="radio"
            accessibilityLabel={`${name.replaceAll("-", " ")} palette`}
            accessibilityState={{ checked: themeName === name }}
            onPress={() => setThemeName(name)}
            style={[styles.choice, themeName === name && styles.choiceActive]}
          >
            <View style={styles.previewRow}>
              {(["light", "dark"] as const).map((mode) => {
                const scheme = themes[name][mode];
                return (
                  <View key={mode} style={styles.previewColumn}>
                    <View style={[styles.preview, { backgroundColor: scheme.colors.canvas }]}>
                      <View
                        style={[styles.previewSidebar, { backgroundColor: scheme.colors.sidebar }]}
                      />
                      <View
                        style={[styles.previewSurface, { backgroundColor: scheme.colors.surface }]}
                      />
                      <View
                        style={[styles.previewAccent, { backgroundColor: scheme.colors.accent }]}
                      />
                    </View>
                    <Text style={styles.previewLabel}>{mode}</Text>
                  </View>
                );
              })}
            </View>
            <Text style={[styles.name, themeName === name && styles.nameActive]}>
              {name.replaceAll("-", " ")}
            </Text>
            {themeName === name && <Text style={styles.check}>✓</Text>}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    content: {
      width: "100%",
      maxWidth: 760,
      alignSelf: "center",
      padding: theme.space.xl,
      paddingBottom: theme.space.giant,
    },
    heading: {
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "700",
      marginBottom: theme.space.sm,
    },
    intro: { color: theme.colors.textMuted, fontSize: 13, marginBottom: theme.space.lg },
    modeRow: {
      flexDirection: "row",
      gap: theme.space.xs,
      padding: theme.space.xs,
      backgroundColor: theme.colors.surfaceRaised,
      borderRadius: theme.radius.md,
      marginBottom: theme.space.sm,
    },
    modeChoice: {
      flex: 1,
      alignItems: "center",
      paddingVertical: theme.space.md,
      borderRadius: theme.radius.sm,
    },
    modeActive: { backgroundColor: theme.colors.surface },
    modeText: { color: theme.colors.textSecondary, fontWeight: "600", fontSize: 13 },
    modeTextActive: { color: theme.colors.accent },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.md },
    choice: {
      width: "47%",
      minWidth: 145,
      flexGrow: 1,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      borderRadius: 11,
      padding: theme.space.sm,
      position: "relative",
      backgroundColor: theme.colors.surface,
    },
    choiceActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSurface },
    previewRow: { flexDirection: "row", gap: theme.space.xs },
    previewColumn: { flex: 1, minWidth: 0 },
    preview: {
      height: 76,
      borderRadius: theme.radius.sm,
      overflow: "hidden",
      position: "relative",
    },
    previewLabel: {
      color: theme.colors.textMuted,
      fontSize: 10,
      textAlign: "center",
      textTransform: "capitalize",
      marginTop: theme.space.xxs,
    },
    previewSidebar: { position: "absolute", left: 0, top: 0, bottom: 0, width: "24%" },
    previewSurface: {
      position: "absolute",
      left: "31%",
      right: "7%",
      top: "20%",
      bottom: "20%",
      borderRadius: 5,
    },
    previewAccent: {
      position: "absolute",
      right: "11%",
      bottom: "27%",
      width: 22,
      height: 7,
      borderRadius: 4,
    },
    name: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      fontWeight: "700",
      textTransform: "capitalize",
      marginTop: theme.space.sm,
    },
    nameActive: { color: theme.colors.accent },
    check: {
      position: "absolute",
      right: theme.space.sm,
      bottom: theme.space.sm,
      color: theme.colors.accent,
      fontWeight: "900",
    },
  });
