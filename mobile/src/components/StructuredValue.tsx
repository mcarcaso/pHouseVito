import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MarkdownText } from "./markdown/MarkdownText";
import { useThemeStyles, type VitoTheme } from "../contexts/theme";

export function parseStructuredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function ValueTree({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const styles = useThemeStyles(createStyles);
  const parsed = parseStructuredValue(value);
  if (parsed !== null && typeof parsed === "object") {
    const entries = Object.entries(parsed as Record<string, unknown>);
    const array = Array.isArray(parsed);
    if (!entries.length) return <Text style={styles.primitive}>{array ? "[]" : "{}"}</Text>;
    return (
      <View style={depth > 0 ? styles.branch : undefined}>
        {entries.map(([key, child]) => (
          <View key={key} style={styles.field}>
            <Text selectable style={styles.key}>
              {array ? Number(key) + 1 : key}
            </Text>
            <ValueTree value={child} depth={depth + 1} />
          </View>
        ))}
      </View>
    );
  }
  if (typeof parsed === "string") return <MarkdownText variant="chat">{parsed}</MarkdownText>;
  return (
    <Text selectable style={styles.primitive}>
      {String(parsed)}
    </Text>
  );
}

export function StructuredValue({ value, rawValue }: { value: unknown; rawValue?: unknown }) {
  const styles = useThemeStyles(createStyles);
  const parsed = useMemo(() => parseStructuredValue(value), [value]);
  const structured = parsed !== null && typeof parsed === "object";
  const [raw, setRaw] = useState(false);
  const source = rawValue ?? parsed;
  const rawText = useMemo(
    () => (typeof source === "string" ? source : JSON.stringify(source, null, 2)),
    [source],
  );
  return (
    <View style={styles.root}>
      {structured && (
        <View style={styles.toolbar}>
          <Pressable onPress={() => setRaw((current) => !current)} hitSlop={8}>
            <Text style={styles.mode}>{raw ? "PRETTY" : "RAW"}</Text>
          </Pressable>
        </View>
      )}
      {raw ? (
        <Text selectable style={styles.raw}>
          {rawText}
        </Text>
      ) : (
        <ValueTree value={parsed} />
      )}
    </View>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    root: { width: "100%" },
    toolbar: { flexDirection: "row", justifyContent: "flex-end", marginBottom: theme.space.sm },
    mode: { color: theme.colors.accent, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
    branch: {
      borderLeftWidth: 1,
      borderLeftColor: theme.colors.separator,
      paddingLeft: theme.space.md,
    },
    field: { gap: theme.space.xs, marginBottom: theme.space.sm },
    key: {
      color: theme.colors.accent,
      fontSize: 10,
      fontWeight: "800",
      textTransform: "uppercase",
    },
    primitive: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 },
    raw: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
  });
