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

export function UpdateControls() {
  const theme = useVitoTheme();
  const [status, setStatus] = useState<Status | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [staged, setStaged] = useState(false);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const value = await api<Status>("/api/server/update/status");
        if (alive) setStatus(value);
      } catch {
        /* Expected while the supervised update restarts the server. */
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
        setMessage(
          "Update queued. This page may disconnect while Vito restarts. Status refreshes automatically.",
        );
        setStaged(false);
      } else {
        const value = await api<{ output: string }>(`/api/server/update/${action}`, {
          method: "POST",
          body: "{}",
        });
        if (action === "check") {
          setStaged(false);
          try {
            setPlan(JSON.parse(value.output) as Plan);
          } catch {
            setPlan(null);
            setMessage(value.output);
          }
        } else {
          setStaged(true);
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
    if (!plan) return;
    const detail =
      plan.dataImpact?.kind === "none"
        ? "No persistent-data changes are declared. No new full backup will be taken."
        : `Backward-compatible migration. A targeted backup will be taken of: ${plan.dataImpact?.files?.join(", ")}. ${plan.dataImpact?.notes ?? ""}`;
    const question = `Apply ${plan.version}?\n\n${detail}\n\nVito will stop, activate this verified release, restart, health-check, and roll back the binary if needed. Existing data is not automatically restored on rollback.`;
    if (Platform.OS === "web") {
      if (window.confirm(question)) void perform("apply");
    } else
      Alert.alert("Apply signed update", question, [
        { text: "Cancel", style: "cancel" },
        { text: "Update", onPress: () => void perform("apply") },
      ]);
  };
  const button = (label: string, action: () => void) => (
    <Pressable
      disabled={busy}
      onPress={action}
      style={{ padding: theme.space.md, opacity: busy ? 0.5 : 1 }}
    >
      <Text style={{ color: theme.colors.text }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ padding: theme.space.lg, gap: theme.space.sm }}>
      <Text style={{ color: theme.colors.text, fontWeight: "600" }}>Signed binary updates</Text>
      {status && !status.supported && (
        <Text style={{ color: theme.colors.text }}>{status.reason}</Text>
      )}
      {status?.supported && (
        <>
          {button(busy ? "Working…" : "Check for update", () => void perform("check"))}
          {plan && (
            <>
              <Text style={{ color: theme.colors.text }}>
                {plan.version} · {plan.revision.slice(0, 12)} ·{" "}
                {plan.dataImpact?.kind ?? "unknown data impact"}
              </Text>
              {plan.dataImpact?.notes && (
                <Text style={{ color: theme.colors.text }}>{plan.dataImpact.notes}</Text>
              )}
              {button("Download and verify", () => void perform("stage"))}
              {staged &&
                ["none", "compatible-migration"].includes(plan.dataImpact?.kind ?? "") &&
                button("Update Vito…", confirmApply)}
              {["breaking", "unknown"].includes(plan.dataImpact?.kind ?? "unknown") && (
                <Text style={{ color: theme.colors.text }}>
                  Operator-led recovery plan required; self-service apply is unavailable.
                </Text>
              )}
            </>
          )}
          {status.operation && (
            <Text style={{ color: theme.colors.text }}>
              Last update: {status.operation.state} {status.operation.version}
            </Text>
          )}
        </>
      )}
      {!!message && <Text style={{ color: theme.colors.text }}>{message}</Text>}
    </View>
  );
}
