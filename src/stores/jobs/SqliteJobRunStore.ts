import { randomUUID } from "node:crypto";
import type { Context } from "../../context/Context.js";
import { xDb } from "../../lib/x.js";
import type { JobRun } from "../../services/jobs/JobService.js";
import type { ScriptJobConfig } from "../../shared/schemas/vito-config.js";
import type { JobRunStore } from "./JobRunStore.js";

interface RunRow {
  data: string;
  cancelled: number;
}

function parseRun(row: RunRow): JobRun {
  return { ...(JSON.parse(row.data) as JobRun), cancelled: row.cancelled === 1 };
}

export class SqliteJobRunStore implements JobRunStore {
  recoverInterrupted(x: Context): number {
    const db = xDb(x);
    const rows = db
      .prepare(
        "SELECT id, data, cancelled FROM job_runs WHERE state = 'running' OR delivery = 'delivering'",
      )
      .all() as Array<RunRow & { id: string }>;
    const finish = db.prepare("UPDATE job_runs SET state = ?, delivery = ?, data = ? WHERE id = ?");
    const transaction = db.transaction(() => {
      let count = 0;
      for (const row of rows) {
        const run = parseRun(row);
        if (run.delivery === "delivering" && run.state !== "running") {
          run.delivery = "unknown";
          run.error = "Delivery was interrupted with an uncertain side effect; it was not replayed";
        } else {
          run.state = run.cancelled ? "cancelled" : "interrupted";
          run.error = run.cancelled
            ? "Run was cancelled before shutdown completed"
            : "Worker stopped before a durable result was saved; script was not replayed";
          run.finishedAt = new Date().toISOString();
          if (run.delivery !== "delivered") run.delivery = "none";
        }
        count += finish.run(run.state, run.delivery, JSON.stringify(run), run.id).changes;
      }
      return count;
    });
    return transaction();
  }

  claim(
    x: Context,
    job: ScriptJobConfig,
    scheduledAt: string,
    startedAt: string,
  ): JobRun | undefined {
    const db = xDb(x);
    const transaction = db.transaction(() => {
      const existing = db
        .prepare(
          "SELECT 1 FROM job_runs WHERE name = ? AND (state = 'running' OR scheduled_at = ?)",
        )
        .get(job.name, scheduledAt);
      if (existing) return undefined;
      const run: JobRun = {
        id: randomUUID(),
        job,
        scheduledAt,
        startedAt,
        finishedAt: null,
        state: "running",
        result: null,
        error: null,
        cancelled: false,
        delivery: "none",
        promptSessions: [],
      };
      db.prepare(
        `INSERT INTO job_runs
           (id, name, state, scheduled_at, started_at, delivery, data, cancelled)
         VALUES (?, ?, 'running', ?, ?, 'none', ?, 0)`,
      ).run(run.id, job.name, scheduledAt, startedAt, JSON.stringify(run));
      return run;
    });
    return transaction();
  }

  save(x: Context, run: JobRun): void {
    xDb(x)
      .prepare(
        `UPDATE job_runs
         SET state = ?, delivery = ?, data = ?, cancelled = ?
         WHERE id = ?`,
      )
      .run(run.state, run.delivery, JSON.stringify(run), run.cancelled ? 1 : 0, run.id);
  }

  read(x: Context, runId: string): JobRun | undefined {
    const row = xDb(x).prepare("SELECT data, cancelled FROM job_runs WHERE id = ?").get(runId) as
      RunRow | undefined;
    return row ? parseRun(row) : undefined;
  }

  list(x: Context, query: { name?: string; limit?: number } = {}): JobRun[] {
    return (
      xDb(x)
        .prepare(
          `SELECT data, cancelled FROM job_runs
           WHERE (? IS NULL OR name = ?)
           ORDER BY started_at DESC, rowid DESC LIMIT ?`,
        )
        .all(query.name ?? null, query.name ?? null, Math.min(query.limit ?? 50, 1_000)) as RunRow[]
    ).map(parseRun);
  }

  cancel(x: Context, runId: string): boolean {
    return (
      xDb(x)
        .prepare("UPDATE job_runs SET cancelled = 1 WHERE id = ? AND state = 'running'")
        .run(runId).changes > 0
    );
  }

  addPrompt(x: Context, runId: string, session: string): void {
    xDb(x)
      .prepare("INSERT INTO job_run_prompts (run_id, sequence, session) VALUES (?, ?, ?)")
      .run(
        runId,
        (
          xDb(x)
            .prepare("SELECT COUNT(*) AS count FROM job_run_prompts WHERE run_id = ?")
            .get(runId) as { count: number }
        ).count,
        session,
      );
  }
}
