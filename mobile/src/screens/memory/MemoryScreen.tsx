import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MarkdownText } from "../../components/markdown/MarkdownText";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";
import { api } from "../../services/api/client";

export type MemoryPage = "answer" | "facts" | "transcripts";
type FactSource = {
  id: number;
  messageId: number;
  sessionId: string;
  quote: string;
  sourceTimestamp: number;
};
type Fact = {
  id: number;
  canonicalText: string;
  kind: string;
  slotKey: string | null;
  status: string;
  authority: string;
  entities: string[];
  sources: FactSource[];
};
type FactSearchResponse = {
  duration_ms: number;
  mode?: "recent";
  results: Array<{ fact: Fact; score: number; conflicts: Fact[] }>;
};
type TranscriptSearchResponse = {
  duration_ms: number;
  mode: string;
  results: Array<{
    id: number;
    session_id: string;
    alias?: string | null;
    day: string;
    text: string;
    context: string | null;
    msg_count: number;
    rrfScore: number;
  }>;
};
type AnswerResponse = {
  answer: string;
  citations: Array<{
    provider: "profile" | "fact" | "transcript";
    id: string;
    label: string;
  }>;
  duration_ms: number;
  provider_counts: { profile: number; facts: number; transcripts: number };
};

export function MemoryScreen({
  onUnauthorized,
  onPageChange,
}: {
  onUnauthorized: () => void;
  onPageChange?: (page: MemoryPage) => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const [page, setPage] = useState<MemoryPage>("answer");
  const [query, setQuery] = useState("");
  const [currentOnly, setCurrentOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AnswerResponse | null>(null);
  const [facts, setFacts] = useState<FactSearchResponse | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptSearchResponse | null>(null);

  useEffect(() => {
    if (page === "answer") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const path =
      page === "facts"
        ? `/api/memory/facts/recent?limit=20&current=${currentOnly}`
        : "/api/memory/embeddings/recent?limit=20";
    void api<FactSearchResponse | TranscriptSearchResponse>(path)
      .then((result) => {
        if (cancelled) return;
        if (page === "facts") setFacts(result as FactSearchResponse);
        else setTranscripts(result as TranscriptSearchResponse);
      })
      .catch((cause) => {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : "Could not load recent memory";
        if (message.toLowerCase().includes("unauthorized")) onUnauthorized();
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentOnly, page]);

  const run = async () => {
    const value = query.trim();
    if (!value || loading) return;
    setLoading(true);
    setError(null);
    try {
      if (page === "answer") {
        setAnswer(
          await api<AnswerResponse>("/api/memory/answer", {
            method: "POST",
            body: JSON.stringify({ query: value, currentOnly }),
          }),
        );
      } else if (page === "facts") {
        setFacts(
          await api<FactSearchResponse>(
            `/api/memory/facts/search?q=${encodeURIComponent(value)}&limit=30&current=${currentOnly}`,
          ),
        );
      } else {
        setTranscripts(
          await api<TranscriptSearchResponse>(
            `/api/memory/embeddings/search?q=${encodeURIComponent(value)}&mode=hybrid&limit=20`,
          ),
        );
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Memory search failed";
      if (message.toLowerCase().includes("unauthorized")) onUnauthorized();
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const placeholder =
    page === "answer"
      ? "Ask Vito's memory a question"
      : page === "facts"
        ? "Search consolidated facts"
        : "Search transcript history";

  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
        {(["answer", "facts", "transcripts"] as const).map((item) => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityState={{ selected: page === item }}
            onPress={() => {
              setPage(item);
              onPageChange?.(item);
              setError(null);
            }}
            style={[styles.tab, page === item && styles.tabActive]}
          >
            <Text style={[styles.tabText, page === item && styles.tabTextActive]}>
              {item[0].toUpperCase() + item.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.content}>
          <View style={styles.searchRow}>
            <View style={styles.searchField}>
              <Ionicons name="search-outline" size={18} color={theme.colors.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={placeholder}
                placeholderTextColor={theme.colors.textMuted}
                multiline={page === "answer"}
                returnKeyType="search"
                blurOnSubmit={false}
                onSubmitEditing={() => void run()}
                style={[styles.input, page === "answer" && styles.answerInput]}
              />
            </View>
            <Pressable
              accessibilityLabel={page === "answer" ? "Answer question" : "Search memory"}
              disabled={!query.trim() || loading}
              onPress={() => void run()}
              style={({ pressed }) => [
                styles.searchButton,
                (!query.trim() || loading) && styles.searchButtonDisabled,
                pressed && styles.pressed,
              ]}
            >
              {loading ? (
                <ActivityIndicator size="small" color={theme.colors.accentText} />
              ) : (
                <Ionicons
                  name={page === "answer" ? "sparkles" : "arrow-forward"}
                  size={18}
                  color={theme.colors.accentText}
                />
              )}
            </Pressable>
          </View>

          {page !== "transcripts" && (
            <Pressable onPress={() => setCurrentOnly((value) => !value)} style={styles.toggleRow}>
              <Ionicons
                name={currentOnly ? "checkbox" : "square-outline"}
                size={20}
                color={currentOnly ? theme.colors.accent : theme.colors.textMuted}
              />
              <Text style={styles.toggleText}>
                {page === "answer" ? "Prefer current state" : "Current and disputed facts only"}
              </Text>
            </Pressable>
          )}

          {error && <Text style={styles.error}>{error}</Text>}
          {page === "answer" && answer && <AnswerResult value={answer} styles={styles} />}
          {page === "facts" && facts && <FactResults value={facts} styles={styles} />}
          {page === "transcripts" && transcripts && (
            <TranscriptResults value={transcripts} styles={styles} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function AnswerResult({
  value,
  styles,
}: {
  value: AnswerResponse;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.results}>
      <Text style={styles.meta}>
        {value.duration_ms}ms · {value.provider_counts.profile} profile ·{" "}
        {value.provider_counts.facts} facts · {value.provider_counts.transcripts} transcripts
      </Text>
      <MarkdownText>{value.answer}</MarkdownText>
      {value.citations.length > 0 && (
        <View style={styles.evidence}>
          <Text style={styles.sectionLabel}>EVIDENCE USED</Text>
          {value.citations.map((citation) => (
            <View key={`${citation.provider}:${citation.id}`} style={styles.citationRow}>
              <Text style={styles.citationId}>
                {citation.provider}:{citation.id}
              </Text>
              <Text style={styles.citationLabel}>{citation.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function FactResults({
  value,
  styles,
}: {
  value: FactSearchResponse;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.results}>
      <Text style={styles.meta}>
        {value.mode === "recent" ? "Latest" : "Found"} {value.results.length} facts
        {value.mode === "recent" ? "" : ` · ${value.duration_ms}ms`}
      </Text>
      {value.results.map(({ fact, score, conflicts }) => (
        <View key={fact.id} style={styles.resultRow}>
          <View style={styles.factMetaRow}>
            <Text style={styles.factId}>FACT {fact.id}</Text>
            <Text style={styles.factKind}>{fact.kind}</Text>
            <Text style={styles.factStatus}>{fact.status}</Text>
            {score > 0 && <Text style={styles.score}>{score.toFixed(4)}</Text>}
          </View>
          <Text style={styles.factText}>{fact.canonicalText}</Text>
          {fact.slotKey && <Text style={styles.slot}>{fact.slotKey}</Text>}
          <Text style={styles.authority}>
            {fact.authority}
            {fact.entities.length ? ` · ${fact.entities.join(" · ")}` : ""}
          </Text>
          {fact.sources.map((source) => (
            <View key={source.id} style={styles.quote}>
              <Text style={styles.quoteText}>“{source.quote}”</Text>
              <Text style={styles.quoteMeta}>
                Message {source.messageId} · {new Date(source.sourceTimestamp).toLocaleString()}
              </Text>
            </View>
          ))}
          {conflicts.length > 0 && (
            <Text style={styles.conflict}>
              Conflicts: {conflicts.map((item) => `Fact ${item.id}`).join(", ")}
            </Text>
          )}
        </View>
      ))}
      {value.results.length === 0 && <Text style={styles.empty}>No matching facts.</Text>}
    </View>
  );
}

function TranscriptResults({
  value,
  styles,
}: {
  value: TranscriptSearchResponse;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.results}>
      <Text style={styles.meta}>
        {value.mode === "recent" ? "Latest" : "Found"} {value.results.length} transcripts
        {value.mode === "recent" ? "" : ` · ${value.duration_ms}ms · ${value.mode}`}
      </Text>
      {value.results.map((result) => (
        <View key={result.id} style={styles.resultRow}>
          <Text style={styles.transcriptTitle}>{result.alias || result.session_id}</Text>
          <Text style={styles.transcriptMeta}>
            {result.day} · {result.msg_count} messages
            {result.rrfScore > 0 ? ` · RRF ${result.rrfScore.toFixed(4)}` : ""}
          </Text>
          {result.context && <Text style={styles.context}>{result.context}</Text>}
          <Text style={styles.transcriptText}>{result.text}</Text>
        </View>
      ))}
      {value.results.length === 0 && <Text style={styles.empty}>No matching transcripts.</Text>}
    </View>
  );
}

function createStyles(theme: VitoTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.canvas },
    tabs: {
      flexDirection: "row",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    tab: {
      flex: 1,
      alignItems: "center",
      paddingVertical: theme.space.md,
      borderBottomWidth: 2,
      borderBottomColor: "transparent",
    },
    tabActive: { borderBottomColor: theme.colors.accent },
    tabText: { color: theme.colors.textMuted, fontSize: 14, fontWeight: "600" },
    tabTextActive: { color: theme.colors.text },
    scrollContent: { flexGrow: 1, padding: theme.space.lg },
    content: { width: "100%", maxWidth: 960, alignSelf: "center" },
    searchRow: { flexDirection: "row", alignItems: "stretch", gap: theme.space.sm },
    searchField: {
      flex: 1,
      minHeight: 46,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.separatorStrong,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: theme.space.md,
    },
    input: { flex: 1, color: theme.colors.text, fontSize: 15, paddingVertical: theme.space.sm },
    answerInput: { minHeight: 64, textAlignVertical: "top" },
    searchButton: {
      width: 46,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radius.sm,
    },
    searchButtonDisabled: { opacity: 0.4 },
    pressed: { opacity: 0.72 },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: theme.space.sm,
      paddingVertical: theme.space.md,
    },
    toggleText: { color: theme.colors.textSecondary, fontSize: 13 },
    error: { color: theme.colors.danger, fontSize: 13, paddingVertical: theme.space.md },
    results: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.separator,
      paddingTop: theme.space.lg,
    },
    meta: { color: theme.colors.textMuted, fontSize: 12, marginBottom: theme.space.lg },
    evidence: {
      marginTop: theme.space.xxl,
      paddingTop: theme.space.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.separator,
    },
    sectionLabel: {
      color: theme.colors.textMuted,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.8,
      marginBottom: theme.space.sm,
    },
    citationRow: { flexDirection: "row", gap: theme.space.md, paddingVertical: theme.space.xs },
    citationId: { width: 96, color: theme.colors.accent, fontFamily: "monospace", fontSize: 12 },
    citationLabel: { flex: 1, color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
    resultRow: {
      paddingVertical: theme.space.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    factMetaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: theme.space.sm,
    },
    factId: { color: theme.colors.textMuted, fontFamily: "monospace", fontSize: 11 },
    factKind: { color: theme.colors.info, fontSize: 11 },
    factStatus: { color: theme.colors.textSecondary, fontSize: 11 },
    score: {
      marginLeft: "auto",
      color: theme.colors.textMuted,
      fontFamily: "monospace",
      fontSize: 11,
    },
    factText: { color: theme.colors.text, fontSize: 15, lineHeight: 22, marginTop: theme.space.sm },
    slot: {
      color: theme.colors.textMuted,
      fontFamily: "monospace",
      fontSize: 11,
      marginTop: theme.space.xs,
    },
    authority: { color: theme.colors.textMuted, fontSize: 11, marginTop: theme.space.xs },
    quote: {
      borderLeftWidth: 2,
      borderLeftColor: theme.colors.separatorStrong,
      paddingLeft: theme.space.md,
      marginTop: theme.space.md,
    },
    quoteText: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
    quoteMeta: { color: theme.colors.textMuted, fontSize: 10, marginTop: theme.space.xs },
    conflict: { color: theme.colors.warning, fontSize: 11, marginTop: theme.space.sm },
    transcriptTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
    transcriptMeta: { color: theme.colors.textMuted, fontSize: 11, marginTop: theme.space.xs },
    context: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      marginTop: theme.space.sm,
    },
    transcriptText: {
      color: theme.colors.textSecondary,
      fontFamily: "monospace",
      fontSize: 11,
      lineHeight: 17,
      marginTop: theme.space.md,
    },
    empty: {
      color: theme.colors.textMuted,
      textAlign: "center",
      paddingVertical: theme.space.xxxl,
    },
  });
}
