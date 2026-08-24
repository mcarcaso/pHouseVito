import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../../services/api/client";
import { StructuredDetail } from "./structured-data";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";

export function OperationItemDetailScreen({
  area,
  id,
}: {
  area: "apps" | "providers";
  id: string;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [data, setData] = useState<unknown>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(undefined);
    setError(null);
    const path =
      area === "apps"
        ? `/api/apps/${encodeURIComponent(id)}/files`
        : `/api/models/${encodeURIComponent(id)}`;
    void api(path)
      .then(setData)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "Could not load details"),
      );
  }, [area, id]);
  if (data === undefined && !error)
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      {error ? <Text style={styles.error}>{error}</Text> : <StructuredDetail value={data} />}
    </ScrollView>
  );
}
const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    content: { padding: theme.space.lg, paddingBottom: theme.space.xxxl },
    error: { color: theme.colors.danger },
  });
