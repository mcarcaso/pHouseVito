import { Ionicons } from "@expo/vector-icons";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { RootStackParamList } from "../../application/navigation/route-types";
import { useThemeStyles, type VitoTheme } from "../../hooks/useVitoTheme";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Destination = "SpeechSettings" | "VoiceModeSettings" | "AppThemeSettings";

const sections: Array<{
  destination: Destination;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  description: string;
}> = [
  {
    destination: "SpeechSettings",
    icon: "volume-high-outline",
    title: "Speech",
    description: "Chat message playback, voice, and speed",
  },
  {
    destination: "VoiceModeSettings",
    icon: "mic-outline",
    title: "Voice Mode",
    description: "Live conversation provider, model, and voice",
  },
  {
    destination: "AppThemeSettings",
    icon: "color-palette-outline",
    title: "Theme",
    description: "Color scheme for this device",
  },
];

export function AppSettingsHomeScreen({ navigation }: { navigation: Navigation }) {
  const styles = useThemeStyles(createStyles);
  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.intro}>Device-specific preferences for the Rook companion app.</Text>
      <View style={styles.list}>
        {sections.map((section) => (
          <Pressable
            key={section.destination}
            onPress={() => navigation.navigate(section.destination)}
            style={styles.row}
          >
            <Ionicons name={section.icon} size={21} style={styles.icon} />
            <View style={styles.copy}>
              <Text style={styles.title}>{section.title}</Text>
              <Text style={styles.description}>{section.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} style={styles.chevron} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    root: {
      width: "100%",
      maxWidth: 680,
      alignSelf: "center",
      padding: theme.space.xl,
      paddingBottom: theme.space.giant,
    },
    intro: { color: theme.colors.textMuted, fontSize: 13, marginBottom: theme.space.xl },
    list: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.separator,
    },
    row: {
      minHeight: 72,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    icon: { width: 28, color: theme.colors.textSecondary },
    copy: { flex: 1 },
    title: { color: theme.colors.text, fontSize: 15, fontWeight: "800" },
    description: { color: theme.colors.textMuted, fontSize: 11, marginTop: theme.space.xs },
    chevron: { color: theme.colors.textMuted },
  });
