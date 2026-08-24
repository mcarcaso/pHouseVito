import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  themes,
  useThemeStyles,
  useVitoThemeController,
  type VitoTheme,
  type VitoThemeName,
} from "./theme";

export function ThemeScreen() {
  const styles = useThemeStyles(createStyles);
  const { themeName, setThemeName } = useVitoThemeController();
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.intro}>Choose a color scheme for this device.</Text>
      <View style={styles.grid}>
        {(Object.entries(themes) as Array<[VitoThemeName, VitoTheme]>).map(([name, scheme]) => (
          <Pressable
            key={name}
            onPress={() => setThemeName(name)}
            style={[styles.choice, themeName === name && styles.choiceActive]}
          >
            <View style={[styles.preview, { backgroundColor: scheme.colors.canvas }]}>
              <View style={[styles.previewSidebar, { backgroundColor: scheme.colors.sidebar }]} />
              <View style={[styles.previewSurface, { backgroundColor: scheme.colors.surface }]} />
              <View style={[styles.previewAccent, { backgroundColor: scheme.colors.accent }]} />
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
    intro: { color: theme.colors.textMuted, fontSize: 13, marginBottom: theme.space.lg },
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
    preview: { height: 76, borderRadius: 8, overflow: "hidden", position: "relative" },
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
