import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  enqueueQuickCommand,
  listQuickCommandOutbox,
  syncQuickCommandOutbox,
} from "../../services/quick-command/outbox";
import { useCurrentRuns } from "../../hooks/useCurrentRuns";
import { useThemeStyles, useVitoTheme, type VitoTheme } from "../../hooks/useVitoTheme";
import { useSessions } from "@vito/client";

const ENABLED_KEY = "vito-quick-command-auto-record-v1";
const DESTINATION_KEY = "vito-quick-command-destination-v1";
const MIN_RECORDING_MS = 650;
const SPEECH_THRESHOLD_DB = -50;
const REQUIRED_SPEECH_SAMPLES = 2;

export interface QuickCommandRecordingStatus {
  recording: boolean;
  durationMs: number;
  stop: () => void;
  cancel: () => void;
}

export function HomeScreen({
  onRecordingStatusChange,
  onOpenRun,
}: {
  onRecordingStatusChange?: (status: QuickCommandRecordingStatus | null) => void;
  onOpenRun: (sessionKey: string) => void;
}) {
  const styles = useThemeStyles(createStyles);
  const theme = useVitoTheme();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 150);
  const [enabled, setEnabled] = useState(false);
  const [destinationSession, setDestinationSession] = useState<string | null>(null);
  const [destinationOpen, setDestinationOpen] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [ready, setReady] = useState(false);
  const [queued, setQueued] = useState(0);
  const [message, setMessage] = useState("Ready when you are");
  const { runs, loading: runsLoading } = useCurrentRuns();
  const stopping = useRef(false);
  const speechSamples = useRef(0);
  const sessionsQuery = useSessions({ refetchInterval: 10_000 });
  const sessions = sessionsQuery.data ?? [];
  const selectedDestination = sessions.find((session) => session.id === destinationSession);
  const visibleSessions = sessions
    .filter((session) => {
      const query = sessionSearch.trim().toLowerCase();
      return (
        !query ||
        session.id.toLowerCase().includes(query) ||
        session.alias?.toLowerCase().includes(query)
      );
    })
    .slice(0, 30);

  const start = useCallback(async () => {
    if (recorder.isRecording || stopping.current) return;
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setMessage("Microphone permission is required");
      return;
    }
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      interruptionMode: "doNotMix",
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
    speechSamples.current = 0;
    await recorder.prepareToRecordAsync();
    recorder.record();
    setMessage("Listening…");
  }, [recorder]);

  const finishRecording = useCallback(
    async (submit: boolean) => {
      if (!recorder.isRecording || stopping.current) return;
      stopping.current = true;
      const durationMs = recorder.getStatus().durationMillis;
      try {
        await recorder.stop();
        if (!submit) {
          setMessage("Recording cancelled");
          return;
        }
        const uri = recorder.uri;
        const meteringAvailable = recorderState.metering !== undefined;
        const containsSpeech =
          !meteringAvailable || speechSamples.current >= REQUIRED_SPEECH_SAMPLES;
        if (uri && durationMs >= MIN_RECORDING_MS && containsSpeech) {
          await enqueueQuickCommand(uri, durationMs, destinationSession ?? undefined);
          setMessage("Saved and queued for Vito");
          const remaining = await syncQuickCommandOutbox();
          setQueued(remaining.length);
          if (!remaining.length) setMessage("Sent to Vito");
        } else {
          setMessage(containsSpeech ? "Nothing recorded" : "No speech detected");
        }
      } catch (cause) {
        setMessage(cause instanceof Error ? cause.message : "Could not finish recording");
      } finally {
        stopping.current = false;
        await setAudioModeAsync({ allowsRecording: false });
      }
    },
    [destinationSession, recorder, recorderState.metering],
  );

  const stop = useCallback(() => finishRecording(true), [finishRecording]);
  const cancel = useCallback(() => finishRecording(false), [finishRecording]);

  useEffect(() => {
    void Promise.all([
      AsyncStorage.getItem(ENABLED_KEY),
      AsyncStorage.getItem(DESTINATION_KEY),
      listQuickCommandOutbox(),
    ]).then(([stored, destination, entries]) => {
      setEnabled(stored === "true");
      setDestinationSession(destination || null);
      setQueued(entries.length);
      setReady(true);
      void syncQuickCommandOutbox().then((remaining) => setQueued(remaining.length));
    });
  }, []);

  useEffect(() => {
    if (
      recorderState.isRecording &&
      typeof recorderState.metering === "number" &&
      recorderState.metering >= SPEECH_THRESHOLD_DB
    ) {
      speechSamples.current += 1;
    }
  }, [recorderState.isRecording, recorderState.metering]);

  useEffect(() => {
    onRecordingStatusChange?.(
      recorderState.isRecording
        ? {
            recording: true,
            durationMs: recorderState.durationMillis,
            stop: () => void stop(),
            cancel: () => void cancel(),
          }
        : null,
    );
    return () => onRecordingStatusChange?.(null);
  }, [
    cancel,
    onRecordingStatusChange,
    recorderState.durationMillis,
    recorderState.isRecording,
    stop,
  ]);

  useEffect(() => {
    if (ready && enabled) {
      void start();
    }
  }, [enabled, ready, start]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") void stop();
      else {
        void syncQuickCommandOutbox().then((remaining) => setQueued(remaining.length));
        if (enabled) void start();
      }
    });
    return () => subscription.remove();
  }, [enabled, start, stop]);

  const updateEnabled = async (value: boolean) => {
    setEnabled(value);
    await AsyncStorage.setItem(ENABLED_KEY, String(value));
    if (!value) await stop();
  };

  const selectDestination = async (sessionId: string | null) => {
    setDestinationSession(sessionId);
    setDestinationOpen(false);
    setSessionSearch("");
    if (sessionId) await AsyncStorage.setItem(DESTINATION_KEY, sessionId);
    else await AsyncStorage.removeItem(DESTINATION_KEY);
  };

  const seconds = Math.floor(recorderState.durationMillis / 1000);
  return (
    <>
      <ScrollView contentContainerStyle={styles.root}>
        <View style={styles.heading}>
          <Text style={styles.title}>Quick Command</Text>
          <Pressable onPress={() => setDestinationOpen(true)} style={styles.destinationControl}>
            <Text style={styles.destinationLabel} numberOfLines={1}>
              {destinationSession
                ? selectedDestination?.alias?.trim() || selectedDestination?.id || "Selected chat"
                : "New chat each time"}
            </Text>
            <Ionicons name="chevron-down" size={15} color={theme.colors.textMuted} />
          </Pressable>
        </View>
        <View style={styles.commandCard}>
          <Pressable
            accessibilityLabel={recorderState.isRecording ? "Stop and send" : "Record command"}
            onPress={() => void (recorderState.isRecording ? stop() : start())}
            style={[styles.commandButton, recorderState.isRecording && styles.commandButtonActive]}
          >
            <Ionicons
              name={recorderState.isRecording ? "stop" : "mic"}
              size={22}
              color={theme.colors.accentText}
            />
          </Pressable>
          <Text style={styles.commandState} numberOfLines={1}>
            {recorderState.isRecording
              ? "Listening — tap stop to send"
              : message === "Ready when you are"
                ? "Tap to speak"
                : message}
          </Text>
          {recorderState.isRecording && (
            <>
              <Text style={styles.commandTimer}>
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
              </Text>
              <Pressable
                accessibilityLabel="Cancel Quick Command recording"
                onPress={() => void cancel()}
                style={styles.cancelButton}
              >
                <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
              </Pressable>
            </>
          )}
        </View>
        <View style={styles.runsSection}>
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>Current runs</Text>
            {!!runs.length && (
              <View style={styles.runCount}>
                <Text style={styles.runCountText}>{runs.length}</Text>
              </View>
            )}
          </View>
          {runsLoading ? (
            <View style={styles.noRuns}>
              <ActivityIndicator size="small" color={theme.colors.accent} />
              <Text style={styles.noRunsText}>Checking current work…</Text>
            </View>
          ) : runs.length === 0 ? (
            <View style={styles.idleRow}>
              <View style={styles.idleDot} />
              <Text style={styles.noRunsText}>Vito is idle</Text>
            </View>
          ) : (
            <View style={styles.runList}>
              {runs.map((run, index) => (
                <Pressable
                  key={`${run.sessionKey}:${run.timestamp}:${index}`}
                  accessibilityLabel={`Open ${run.sessionKey} chat`}
                  onPress={() => onOpenRun(run.sessionKey)}
                  style={({ pressed }) => [styles.runRow, pressed && styles.runRowPressed]}
                >
                  <View
                    style={[
                      styles.runIndicator,
                      run.status === "queued" && styles.runIndicatorQueued,
                    ]}
                  />
                  <View style={styles.settingCopy}>
                    <View style={styles.runTop}>
                      <Text numberOfLines={1} style={styles.runSession}>
                        {run.sessionKey}
                      </Text>
                      <Text style={styles.runStatus}>{run.status}</Text>
                    </View>
                    <Text numberOfLines={2} style={styles.runPreview}>
                      {run.preview || "Processing attachment"}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>
        {!!queued && (
          <View style={styles.outbox}>
            <Ionicons name="cloud-upload-outline" size={19} color={theme.colors.warning} />
            <View style={styles.settingCopy}>
              <Text style={styles.outboxTitle}>
                {queued} saved command{queued === 1 ? "" : "s"}
              </Text>
              <Text style={styles.settingText}>
                Safely stored on this device and waiting to upload.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
      <Modal
        transparent
        visible={destinationOpen}
        animationType="slide"
        onRequestClose={() => setDestinationOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setDestinationOpen(false)}>
          <Pressable style={styles.destinationSheet} onPress={(event) => event.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Send commands to</Text>
            <Pressable onPress={() => void selectDestination(null)} style={styles.destinationRow}>
              <View style={styles.destinationIcon}>
                <Ionicons name="add" size={20} color={theme.colors.accent} />
              </View>
              <View style={styles.settingCopy}>
                <Text style={styles.destinationTitle}>New chat each time</Text>
                <Text style={styles.settingText}>Independent commands can run in parallel.</Text>
              </View>
              {!destinationSession && (
                <Ionicons name="checkmark" size={20} color={theme.colors.accent} />
              )}
            </Pressable>
            <Text style={styles.sheetSectionLabel}>OR CONTINUE IN A CHAT</Text>
            <TextInput
              value={sessionSearch}
              onChangeText={setSessionSearch}
              placeholder="Search chats"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.sessionSearch}
            />
            <ScrollView style={styles.sessionList} keyboardShouldPersistTaps="handled">
              {visibleSessions.map((session) => (
                <Pressable
                  key={session.id}
                  onPress={() => void selectDestination(session.id)}
                  style={styles.destinationRow}
                >
                  <View style={styles.destinationIcon}>
                    <Ionicons
                      name="chatbubble-outline"
                      size={17}
                      color={theme.colors.textSecondary}
                    />
                  </View>
                  <View style={styles.settingCopy}>
                    <Text style={styles.destinationTitle} numberOfLines={1}>
                      {session.alias?.trim() || session.id}
                    </Text>
                    {!!session.alias && (
                      <Text style={styles.sessionId} numberOfLines={1}>
                        {session.id}
                      </Text>
                    )}
                  </View>
                  {destinationSession === session.id && (
                    <Ionicons name="checkmark" size={20} color={theme.colors.accent} />
                  )}
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.sheetSetting}>
              <View style={styles.settingCopy}>
                <Text style={styles.settingTitle}>Listen when Vito opens</Text>
                <Text style={styles.settingText}>Start Quick Command automatically.</Text>
              </View>
              <Switch
                value={enabled}
                onValueChange={(value) => void updateEnabled(value)}
                trackColor={{ true: theme.colors.accent }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const createStyles = (theme: VitoTheme) =>
  StyleSheet.create({
    root: {
      flexGrow: 1,
      width: "100%",
      maxWidth: 680,
      alignSelf: "center",
      padding: theme.space.lg,
      gap: theme.space.lg,
      paddingBottom: theme.space.xxxl,
    },
    heading: {
      paddingTop: theme.space.xs,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.space.md,
    },
    title: { color: theme.colors.text, fontSize: 20, fontWeight: "900" },
    destinationControl: {
      maxWidth: "58%",
      minHeight: 32,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.xs,
      paddingHorizontal: theme.space.sm,
      borderRadius: 10,
      backgroundColor: theme.colors.surfaceRaised,
    },
    destinationLabel: {
      flexShrink: 1,
      color: theme.colors.textSecondary,
      fontSize: 11,
      fontWeight: "800",
    },
    runsSection: { gap: theme.space.sm },
    sectionHeading: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
    sectionTitle: { color: theme.colors.text, fontSize: 20, fontWeight: "900" },
    runCount: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: theme.space.sm,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.accentSurface,
    },
    runCountText: { color: theme.colors.accent, fontSize: 10, fontWeight: "900" },
    noRuns: {
      minHeight: 58,
      paddingHorizontal: theme.space.lg,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.sm,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      backgroundColor: theme.colors.surface,
    },
    idleRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: theme.space.sm },
    idleDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.textMuted },
    noRunsText: { color: theme.colors.textMuted, fontSize: 12, fontWeight: "700" },
    runList: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      backgroundColor: theme.colors.surface,
      overflow: "hidden",
    },
    runRow: {
      minHeight: 68,
      padding: theme.space.md,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    runRowPressed: { opacity: 0.65 },
    runIndicator: {
      width: 9,
      height: 9,
      borderRadius: 5,
      marginTop: theme.space.xs,
      backgroundColor: theme.colors.success,
    },
    runIndicatorQueued: { backgroundColor: theme.colors.warning },
    runTop: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
    runSession: { flex: 1, color: theme.colors.text, fontSize: 12, fontWeight: "800" },
    runStatus: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "900",
      textTransform: "uppercase",
    },
    runPreview: {
      color: theme.colors.textMuted,
      fontSize: 11,
      lineHeight: 16,
      marginTop: theme.space.xs,
    },
    commandCard: {
      minHeight: 62,
      padding: theme.space.sm,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.colors.separatorStrong,
    },
    commandButton: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.accent,
    },
    commandButtonActive: { backgroundColor: theme.colors.danger },
    commandState: { flex: 1, color: theme.colors.textSecondary, fontSize: 13, fontWeight: "700" },
    commandTimer: { color: theme.colors.textMuted, fontSize: 11, fontVariant: ["tabular-nums"] },
    cancelButton: {
      width: 36,
      height: 36,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surfaceRaised,
    },
    settingCopy: { flex: 1, minWidth: 0 },
    settingTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "800" },
    settingText: {
      color: theme.colors.textMuted,
      fontSize: 11,
      lineHeight: 16,
      marginTop: theme.space.xs,
    },
    outbox: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      padding: theme.space.lg,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.colors.separator,
      backgroundColor: theme.colors.surface,
    },
    outboxTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "800" },
    modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
    destinationSheet: {
      maxHeight: "82%",
      paddingHorizontal: theme.space.lg,
      paddingTop: theme.space.sm,
      paddingBottom: theme.space.xxl,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      backgroundColor: theme.colors.canvas,
    },
    sheetHandle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      alignSelf: "center",
      marginBottom: theme.space.lg,
      backgroundColor: theme.colors.separatorStrong,
    },
    sheetTitle: {
      color: theme.colors.text,
      fontSize: 20,
      fontWeight: "900",
      marginBottom: theme.space.md,
    },
    sheetSectionLabel: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontWeight: "900",
      letterSpacing: 1.1,
      marginTop: theme.space.lg,
      marginBottom: theme.space.sm,
    },
    destinationRow: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.separator,
    },
    destinationIcon: {
      width: 34,
      height: 34,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surfaceRaised,
    },
    destinationTitle: { color: theme.colors.text, fontSize: 13, fontWeight: "800" },
    sessionId: {
      color: theme.colors.textMuted,
      fontSize: 9,
      fontFamily: "monospace",
      marginTop: theme.space.xs,
    },
    sessionSearch: {
      height: 40,
      paddingHorizontal: theme.space.md,
      borderRadius: 12,
      color: theme.colors.text,
      backgroundColor: theme.colors.surfaceRaised,
    },
    sessionList: { maxHeight: 300 },
    sheetSetting: {
      minHeight: 64,
      marginTop: theme.space.md,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.md,
    },
  });
