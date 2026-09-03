export type VoiceTaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export function hasDeliverableVoiceTaskResult(
  status: VoiceTaskStatus,
): status is "completed" | "failed" {
  return status === "completed" || status === "failed";
}
