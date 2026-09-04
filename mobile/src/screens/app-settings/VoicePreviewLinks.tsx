import { Ionicons } from "@expo/vector-icons";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";

export type VoicePreviewProvider = "openai" | "gemini" | "openrouter";

const links: Record<Exclude<VoicePreviewProvider, "openrouter">, { label: string; url: string }> = {
  openai: { label: "Preview OpenAI voices", url: "https://www.openai.fm/" },
  gemini: {
    label: "Preview Gemini voices",
    url: "https://docs.cloud.google.com/text-to-speech/docs/gemini-tts#voice_options",
  },
};

export function VoicePreviewLinks({
  providers,
  openRouterModel,
}: {
  providers: VoicePreviewProvider[];
  openRouterModel?: string;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  return (
    <View style={styles.links}>
      {providers.map((provider) => {
        const link =
          provider === "openrouter"
            ? openRouterModel
              ? {
                  label: "Preview this model’s voices on OpenRouter",
                  url: `https://openrouter.ai/${openRouterModel
                    .split("/")
                    .map(encodeURIComponent)
                    .join("/")}`,
                }
              : null
            : links[provider];
        if (!link) return null;
        return (
          <Pressable
            accessibilityRole="link"
            key={provider}
            onPress={() => void Linking.openURL(link.url)}
            style={styles.link}
          >
            <Ionicons name="volume-high-outline" size={17} color={theme.colors.accent} />
            <Text style={styles.text}>{link.label}</Text>
            <Ionicons name="open-outline" size={14} color={theme.colors.textMuted} />
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    links: {
      marginTop: theme.space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.separator,
    },
    link: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    text: { flex: 1, color: theme.colors.accent, fontSize: 12, fontWeight: "700" },
  });
