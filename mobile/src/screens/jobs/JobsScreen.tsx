import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "../../services/api/client";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";

type Job = {
  name: string;
  schedule: string;
  timezone?: string;
  session: string;
  prompt: string;
  oneTime?: boolean;
  sendCondition?: string;
  precheckCommand?: string;
};
export function JobsScreen({
  onOpen,
  onNew,
  refreshKey = 0,
}: {
  onOpen: (name: string) => void;
  onNew?: () => void;
  refreshKey?: number;
}) {
  const s = useThemeStyles(styles),
    t = useVitoTheme(),
    [jobs, setJobs] = useState<Job[]>([]),
    [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    void api<Job[]>("/api/cron/jobs")
      .then(setJobs)
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load, refreshKey]);
  const run = (name: string) =>
    Alert.alert("Run job now?", name, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Run",
        onPress: () =>
          void api(`/api/cron/jobs/${encodeURIComponent(name)}/trigger`, { method: "POST" }),
      },
    ]);
  return (
    <View style={s.root}>
      {onNew && (
        <View style={s.toolbar}>
          <Text style={s.toolbarTitle}>{jobs.length} jobs</Text>
          <Pressable onPress={load} style={s.icon}>
            <Ionicons name="refresh" size={19} color={t.colors.textSecondary} />
          </Pressable>
          <Pressable onPress={onNew} style={s.newButton}>
            <Ionicons name="add" size={18} color={t.colors.accentText} />
            <Text style={s.newText}>New</Text>
          </Pressable>
        </View>
      )}
      <ScrollView contentContainerStyle={s.content}>
        {loading ? (
          <ActivityIndicator color={t.colors.accent} />
        ) : (
          <View style={s.grid}>
            {jobs.map((j) => (
              <Pressable key={j.name} onPress={() => onOpen(j.name)} style={s.card}>
                <View style={s.cardHead}>
                  <View style={s.identity}>
                    <Text style={s.name} numberOfLines={1}>
                      {j.name}
                    </Text>
                    <Text style={s.session} numberOfLines={1}>
                      {j.session}
                    </Text>
                  </View>
                  {j.oneTime && <Text style={s.badge}>ONE-TIME</Text>}
                  {j.sendCondition && <Text style={s.badge}>CONDITIONAL</Text>}
                </View>
                <View style={s.facts}>
                  <View style={s.fact}>
                    <Text style={s.label}>SCHEDULE</Text>
                    <Text style={s.value}>{human(j.schedule)}</Text>
                  </View>
                  <View style={s.fact}>
                    <Text style={s.label}>CRON</Text>
                    <Text style={s.cron}>{j.schedule}</Text>
                  </View>
                </View>
                <Text style={s.prompt} numberOfLines={2}>
                  {j.prompt}
                </Text>
                <View style={s.foot}>
                  <Text style={s.details}>Details</Text>
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      run(j.name);
                    }}
                    style={s.run}
                  >
                    <Ionicons name="play" size={12} color={t.colors.success} />
                    <Text style={s.runText}>Run now</Text>
                  </Pressable>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
export function JobEditorScreen({ name, onDone }: { name?: string; onDone: () => void }) {
  const s = useThemeStyles(styles),
    t = useVitoTheme(),
    [job, setJob] = useState<Job>({
      name: "",
      schedule: "",
      timezone: "America/Toronto",
      session: "dashboard:default",
      prompt: "",
    }),
    [loading, setLoading] = useState(Boolean(name)),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    void api<Job[]>("/api/cron/jobs")
      .then((v) => {
        if (name) {
          const found = v.find((x) => x.name === name);
          if (found) setJob(found);
        }
      })
      .finally(() => setLoading(false));
  }, [name]);
  const field = (key: keyof Job, label: string, multi = false) => (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        value={String(job[key] ?? "")}
        onChangeText={(v) => setJob({ ...job, [key]: v })}
        multiline={multi}
        style={[s.input, multi && s.textarea]}
      />
    </View>
  );
  const save = async () => {
    setSaving(true);
    await api(name ? `/api/cron/jobs/${encodeURIComponent(name)}` : "/api/cron/jobs", {
      method: name ? "PUT" : "POST",
      body: JSON.stringify(job),
    });
    setSaving(false);
    onDone();
  };
  const del = () =>
    name &&
    Alert.alert("Delete job?", name, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          void api(`/api/cron/jobs/${encodeURIComponent(name)}`, { method: "DELETE" }).then(onDone),
      },
    ]);
  if (loading)
    return (
      <View style={s.center}>
        <ActivityIndicator color={t.colors.accent} />
      </View>
    );
  return (
    <ScrollView contentContainerStyle={s.editor}>
      {field("name", "Name")}
      {field("schedule", "Cron schedule")}
      {field("timezone", "Timezone")}
      {field("session", "Session")}
      {field("prompt", "Prompt", true)}
      {field("sendCondition", "Send condition", true)}
      {field("precheckCommand", "Precheck command", true)}
      <Pressable disabled={saving} onPress={save} style={s.save}>
        <Text style={s.saveText}>{saving ? "Saving…" : name ? "Save changes" : "Create job"}</Text>
      </Pressable>
      {name && (
        <Pressable onPress={del} style={s.delete}>
          <Text style={s.deleteText}>Delete job</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
function human(c: string) {
  const p = c.trim().split(/\s+/);
  if (p.length !== 5) return c;
  if (c === "*/5 * * * *") return "Every 5 minutes";
  if (c === "*/10 * * * *") return "Every 10 minutes";
  if (c === "*/30 * * * *") return "Every 30 minutes";
  if (p[2] === "*" && p[3] === "*") {
    const h = Number(p[1]),
      m = p[0].padStart(2, "0"),
      time = `${h % 12 || 12}:${m} ${h >= 12 ? "PM" : "AM"}`;
    return p[4] === "*"
      ? `Daily · ${time}`
      : p[4] === "1-5"
        ? `Weekdays · ${time}`
        : `${time} · cron ${p[4]}`;
  }
  return c;
}
const styles = (t: VitoTheme) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    root: { flex: 1 },
    toolbar: {
      height: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.sm,
      paddingHorizontal: t.space.lg,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.separator,
    },
    toolbarTitle: { flex: 1, color: t.colors.textMuted, fontSize: 12 },
    icon: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
    newButton: {
      height: 34,
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.xs,
      paddingHorizontal: t.space.md,
      borderRadius: 8,
      backgroundColor: t.colors.accent,
    },
    newText: { color: t.colors.accentText, fontWeight: "800", fontSize: 12 },
    content: { padding: t.space.lg, paddingBottom: t.space.giant },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: t.space.md },
    card: {
      flexGrow: 1,
      width: "47%",
      minWidth: 290,
      borderWidth: 1,
      borderColor: t.colors.separator,
      borderRadius: 12,
      padding: t.space.lg,
      backgroundColor: t.colors.surface,
    },
    cardHead: { flexDirection: "row", alignItems: "flex-start", gap: t.space.sm },
    identity: { flex: 1, minWidth: 0 },
    name: { color: t.colors.text, fontWeight: "800", fontSize: 14 },
    session: { color: t.colors.textMuted, fontSize: 11, marginTop: t.space.xxs },
    badge: {
      color: t.colors.accent,
      fontSize: 8,
      fontWeight: "900",
      borderWidth: 1,
      borderColor: t.colors.accent,
      borderRadius: 4,
      paddingHorizontal: t.space.xs,
      paddingVertical: t.space.xxs,
    },
    facts: {
      flexDirection: "row",
      gap: t.space.md,
      paddingVertical: t.space.md,
      marginVertical: t.space.md,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: t.colors.separator,
    },
    fact: { flex: 1 },
    label: { color: t.colors.textMuted, fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
    value: { color: t.colors.textSecondary, fontSize: 13, marginTop: t.space.xs },
    cron: {
      color: t.colors.textSecondary,
      fontSize: 11,
      fontFamily: "monospace",
      marginTop: t.space.xs,
    },
    prompt: { color: t.colors.textSecondary, fontSize: 12, lineHeight: 17, minHeight: 34 },
    foot: { flexDirection: "row", alignItems: "center", marginTop: t.space.md },
    details: { color: t.colors.textMuted, fontSize: 11 },
    run: {
      marginLeft: "auto",
      flexDirection: "row",
      alignItems: "center",
      gap: t.space.xs,
      borderWidth: 1,
      borderColor: t.colors.success,
      borderRadius: 7,
      paddingHorizontal: t.space.sm,
      paddingVertical: t.space.sm,
    },
    runText: { color: t.colors.success, fontSize: 11, fontWeight: "700" },
    editor: {
      width: "100%",
      maxWidth: 720,
      alignSelf: "center",
      padding: t.space.xl,
      paddingBottom: t.space.giant,
    },
    editorTitle: {
      color: t.colors.text,
      fontSize: 18,
      fontWeight: "800",
      marginBottom: t.space.xl,
    },
    field: { marginBottom: t.space.lg },
    input: {
      color: t.colors.text,
      backgroundColor: t.colors.surface,
      borderWidth: 1,
      borderColor: t.colors.separatorStrong,
      borderRadius: 9,
      padding: t.space.md,
      marginTop: t.space.xs,
    },
    textarea: { minHeight: 110, textAlignVertical: "top" },
    save: {
      backgroundColor: t.colors.accent,
      borderRadius: 9,
      padding: t.space.md,
      alignItems: "center",
    },
    saveText: { color: t.colors.accentText, fontWeight: "800" },
    delete: { alignItems: "center", padding: t.space.lg, marginTop: t.space.md },
    deleteText: { color: t.colors.danger, fontWeight: "700" },
  });
