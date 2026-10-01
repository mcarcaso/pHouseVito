import { useEffect, useState } from "react";
import { Alert, Platform, Pressable, Text, View } from "react-native";
import { api } from "../../services/api/client";
import { useVitoTheme } from "../../hooks/useVitoTheme";

type Plan = {
  version: string;
  revision: string;
  dataImpact?: { kind: string; notes?: string; files?: string[] };
};
type Status = {
  supported: boolean;
  reason?: string;
  operation?: { state?: string; version?: string };
};
const activeStates = new Set(["queued", "installing", "stopping", "backing-up", "starting"]);
const stateLabels: Record<string, string> = {
  queued: "Update queued",
  installing: "Installing verified release",
  stopping: "Stopping Vito",
  "backing-up": "Taking targeted backup",
  starting: "Starting and checking health",
  succeeded: "Update completed",
  "rolled-back": "Update rolled back — previous release restored",
  "failed-before-activation": "Update failed before activation",
  "recovery-required": "Operator recovery required",
};

export function UpdateControls() {
  const theme = useVitoTheme();
  const [status, setStatus] = useState<Status | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [staged, setStaged] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const operation = status?.operation?.state;
  const running = activeStates.has(operation ?? "");
  const blocked = busy || running || operation === "recovery-required";
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const value = await api<Status>("/api/server/update/status");
        if (alive) {
          setStatus(value);
          setDisconnected(false);
          if (
            ["succeeded", "rolled-back", "failed-before-activation", "recovery-required"].includes(
              value.operation?.state ?? "",
            )
          ) {
            setMessage((current) => (current.startsWith("Update queued.") ? "" : current));
          }
        }
      } catch {
        if (alive) setDisconnected(true);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const perform = async (action: "check" | "stage" | "apply") => {
    setBusy(true);
    setMessage("");
    if (action !== "apply") setStaged(false);
    if (action === "check") setPlan(null);
    try {
      if (action === "apply") {
        if (!plan) return;
        await api("/api/server/update/apply", {
          method: "POST",
          body: JSON.stringify({
            version: plan.version,
            revision: plan.revision,
            approved: true,
            approveMigration: plan.dataImpact?.kind === "compatible-migration",
          }),
        });
        setStatus({ supported: true, operation: { state: "queued", version: plan.version } });
        setMessage("Update queued. Vito may briefly disconnect while it restarts.");
        setStaged(false);
        setPlan(null);
      } else {
        const value = await api<{ output: string; stagedPlan?: Plan }>(
          `/api/server/update/${action}`,
          { method: "POST", body: "{}" },
        );
        if (action === "check") {
          try {
            const next = JSON.parse(value.output) as Plan;
            if (!next.version || !/^[a-f0-9]{40}$/.test(next.revision))
              throw new Error("Invalid update plan");
            setPlan(next);
          } catch {
            setMessage(value.output);
          }
        } else if (value.stagedPlan) {
          // The feed can change between check and download. Confirm the signed bytes actually staged.
          setPlan(value.stagedPlan);
          setStaged(true);
          setMessage("Download verified. Ready for your approval.");
        } else {
          setPlan(null);
          setMessage(value.output);
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };
  const confirmApply = () => {
    if (!plan || blocked) return;
    const detail =
      plan.dataImpact?.kind === "none"
        ? "No persistent-data changes are declared. No new full backup will be taken."
        : `Backward-compatible migration. A targeted backup will be taken of: ${plan.dataImpact?.files?.join(", ")}. ${plan.dataImpact?.notes ?? ""}`;
    const question = `Apply ${plan.version}?\nRevision: ${plan.revision}\n\n${detail}\n\nVito will stop, activate this verified release, restart, health-check, and roll back the binary if needed. Existing data is not automatically restored on rollback.`;
    if (Platform.OS === "web") {
      if (window.confirm(question)) void perform("apply");
    } else
      Alert.alert("Apply signed update", question, [
        { text: "Cancel", style: "cancel" },
        { text: "Update", onPress: () => void perform("apply") },
      ]);
  };
  const button = (label: string, action: () => void, primary = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={blocked}
      onPress={action}
      style={({ pressed }) => ({
        padding: theme.space.md,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: primary ? theme.colors.accent : theme.colors.separatorStrong,
        backgroundColor: primary ? theme.colors.accent : theme.colors.surfaceRaised,
        opacity: blocked ? 0.5 : pressed ? 0.8 : 1,
        minHeight: 44,
        justifyContent: "center",
      })}
    >
      <Text
        style={{
          color: primary ? theme.colors.accentText : theme.colors.text,
          fontWeight: "600",
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
  const text = { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20 };
  return (
    <View
      style={{
        padding: theme.space.lg,
        gap: theme.space.md,
        width: "100%",
        maxWidth: 760,
        alignSelf: "center",
        marginBottom: theme.space.md,
        borderWidth: 1,
        borderColor: theme.colors.separator,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.surface,
      }}
    >
      <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>
        Signed binary updates
      </Text>
      {!status && (
        <Text style={text}>
          {disconnected
            ? "Cannot reach update status. Retrying automatically…"
            : "Loading update status…"}
        </Text>
      )}
      {status && !status.supported && <Text style={text}>{status.reason}</Text>}
      {status?.supported && (
        <>
          <Text style={text}>Verified releases only. You approve before Vito restarts.</Text>
          {button(busy ? "Working…" : "Check for update", () => void perform("check"))}
          {plan && (
            <>
              <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
                {plan.version.replace(/([._-])/g, "$1\u200b")}
              </Text>
              <Text style={text}>Revision {plan.revision.slice(0, 12)}</Text>
              <Text style={text}>
                {plan.dataImpact?.kind === "none"
                  ? "No data migration · no fresh backup required"
                  : plan.dataImpact?.kind === "compatible-migration"
                    ? `Targeted backup: ${plan.dataImpact.files?.join(", ")}`
                    : "Operator-led recovery plan required; self-service apply is unavailable."}
              </Text>
              {plan.dataImpact?.notes && <Text style={text}>{plan.dataImpact.notes}</Text>}
              {!staged && button("Download and verify", () => void perform("stage"))}
              {staged &&
                ["none", "compatible-migration"].includes(plan.dataImpact?.kind ?? "") &&
                button("Update Vito…", confirmApply, true)}
            </>
          )}
          {operation && (
            <Text
              accessibilityLiveRegion="polite"
              style={{
                ...text,
                color:
                  operation === "recovery-required"
                    ? theme.colors.danger
                    : theme.colors.textSecondary,
              }}
            >
              {stateLabels[operation] ?? operation}
              {status.operation?.version ? ` · ${status.operation.version}` : ""}
            </Text>
          )}
          {operation === "recovery-required" && (
            <Text style={text}>
              Ask an operator to inspect the service and retained update lock before retrying.
            </Text>
          )}
          {disconnected && (
            <Text style={text}>Connection interrupted. Retrying update status automatically…</Text>
          )}
        </>
      )}
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={text}>
          {message.slice(0, 600)}
        </Text>
      )}
    </View>
  );
}
