import type { Context } from "../../context/Context.js";
import type { ScriptJobConfig } from "../../shared/schemas/vito-config.js";

export type JobRunState =
  "running" | "completed" | "skipped" | "failed" | "interrupted" | "cancelled";
export type JobDeliveryState =
  "none" | "pending" | "delivering" | "delivered" | "failed" | "unknown";

export interface JobResult {
  text: string;
  files?: string[];
}

export interface JobRun {
  id: string;
  job: ScriptJobConfig;
  scheduledAt: string;
  startedAt: string;
  finishedAt: string | null;
  state: JobRunState;
  result: JobResult | null;
  error: string | null;
  cancelled: boolean;
  delivery: JobDeliveryState;
  /** Only set for jobs delivered after chat-context mirroring was introduced. */
  contextDelivery?: "pending" | "appended";
  promptSessions: string[];
}

export interface JobService {
  recover(x: Context): void;
  execute(x: Context, job: ScriptJobConfig, scheduledAt: string): Promise<JobRun | undefined>;
  cancel(x: Context, runId: string): boolean;
  runs(x: Context, query?: { name?: string; limit?: number }): JobRun[];
}
