import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  getVoiceSession,
  getVoiceSessions,
  type VoiceSession,
  type VoiceSessionDetail,
} from "../../services/api/client";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";

export function VoiceHistoryScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [items, setItems] = useState<VoiceSession[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void getVoiceSessions()
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);
  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.list}>
      {items.map((item) => (
        <Pressable key={item.id} onPress={() => onOpen(item.id)} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
              {item.alias?.startsWith("Voice —")
                ? "Voice conversation"
                : (item.alias ?? "Voice conversation")}
            </Text>
            <Text style={styles.meta}>
              {new Date(item.created_at).toLocaleDateString()} ·{" "}
              {new Date(item.created_at).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}
      {items.length === 0 && <Text style={styles.empty}>No past conversations</Text>}
    </ScrollView>
  );
}
export function VoiceHistoryDetailScreen({ id }: { id: string }) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [detail, setDetail] = useState<VoiceSessionDetail | null>(null);
  useEffect(() => {
    void getVoiceSession(id).then(setDetail);
  }, [id]);
  if (!detail)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.detail}>
      {detail.messages
        .filter((message) => message.type === "user" || message.type === "assistant")
        .map((message, index) => (
          <View key={`${message.type}-${index}`} style={styles.message}>
            <Text style={styles.role}>{message.type === "user" ? "Mike" : "Vito"}</Text>
            <Text selectable style={styles.body}>
              {message.content}
            </Text>
          </View>
        ))}
    </ScrollView>
  );
}
const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    list: { paddingHorizontal: theme.space.lg, paddingBottom: theme.space.xxxl },
    row: {
      minHeight: 68,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.separator,
    },
    title: { color: theme.colors.text, fontSize: 14, fontWeight: "800" },
    meta: { color: theme.colors.textMuted, fontSize: 11, marginTop: 4 },
    chevron: { color: theme.colors.textMuted, fontSize: 20 },
    empty: { color: theme.colors.textMuted, textAlign: "center", padding: theme.space.xxxl },
    detail: { padding: theme.space.lg, paddingBottom: theme.space.xxxl, gap: theme.space.md },
    message: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      borderRadius: 13,
      padding: theme.space.lg,
    },
    role: {
      color: theme.colors.accent,
      fontSize: 9,
      fontWeight: "900",
      letterSpacing: 1.1,
      textTransform: "uppercase",
      marginBottom: theme.space.sm,
    },
    body: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20 },
  });
