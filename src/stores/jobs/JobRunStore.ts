import type { Context } from "../../context/Context.js";
import type { JobRun } from "../../services/jobs/JobService.js";
import type { ScriptJobConfig } from "../../shared/schemas/vito-config.js";

export interface JobRunStore {
  recoverInterrupted(x: Context): number;
  claim(
    x: Context,
    job: ScriptJobConfig,
    scheduledAt: string,
    startedAt: string,
  ): JobRun | undefined;
  save(x: Context, run: JobRun): void;
  read(x: Context, runId: string): JobRun | undefined;
  list(x: Context, query?: { name?: string; limit?: number }): JobRun[];
  listPendingContext(x: Context): JobRun[];
  cancel(x: Context, runId: string): boolean;
  addPrompt(x: Context, runId: string, session: string): void;
}
