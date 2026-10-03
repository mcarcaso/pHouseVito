import { resolveJobTime } from "../../shared/job-time.js";
import { randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Cron } from "croner";
import type { Context } from "../../context/Context.js";
import { xDb, xJobService } from "../../lib/x.js";
import { DEFAULT_TIMEZONE } from "../../shared/defaults.js";
import type { InboundEvent } from "../../lib/types/inbound-event.js";
import {
  isScriptJob,
  type CronJobConfig,
  type LegacyCronJobConfig,
  type ScriptJobConfig,
} from "../../shared/schemas/vito-config.js";
import type { CronHealth, CronService, StartCronArgs } from "./CronService.js";

const execAsync = promisify(exec);

export class CronerCronService implements CronService {
  private readonly jobs = new Map<string, Pick<Cron, "stop" | "isRunning" | "nextRun">>();
  private readonly jobConfigs = new Map<string, CronJobConfig>();
  private globalTimezone = DEFAULT_TIMEZONE;
  private onJob?: (event: InboundEvent, channelName: string | null) => Promise<void>;
  private onJobComplete?: (jobName: string) => Promise<void>;

  private setTimezone(tz: string): void {
    this.globalTimezone = tz;
    console.log(`[Cron] Global timezone set to: ${tz}`);
  }

  private getJobTimezone(job: CronJobConfig): string {
    if (isScriptJob(job)) {
      return "cron" in job.schedule ? (job.schedule.timezone ?? "America/Toronto") : "UTC";
    }
    return job.timezone || "America/Toronto";
  }

  getScheduleError(_x: Context, job: CronJobConfig, globalTimezone?: string): string | null {
    if (isScriptJob(job)) {
      if ("at" in job.schedule) {
        let date: Date;
        try {
          date = new Date(
            resolveJobTime(job.schedule.at, job.schedule.timezone ?? "America/Toronto"),
          );
        } catch (error) {
          return String(error);
        }
        if (Number.isNaN(date.getTime())) return "Invalid one-time schedule";
        if (date.getTime() <= Date.now()) return "One-time schedule must be in the future";
        return null;
      }
      try {
        const cron = new Cron(job.schedule.cron, {
          paused: true,
          timezone: job.schedule.timezone ?? "America/Toronto",
        });
        cron.stop();
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : "Invalid cron schedule";
      }
    }

    const timezone = job.timezone || "America/Toronto";
    if (this.isISODate(job.schedule)) {
      const date = new Date(job.schedule);
      if (Number.isNaN(date.getTime())) return "Invalid ISO date schedule";
      if (date.getTime() <= Date.now()) return "One-time schedule must be in the future";
      return null;
    }
    try {
      const cron = new Cron(job.schedule, { paused: true, timezone });
      cron.stop();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid cron schedule";
    }
  }

  start(x: Context, args: StartCronArgs): void {
    this.stop(x);
    this.onJob = args.onJob;
    this.onJobComplete = args.onJobComplete;
    this.globalTimezone = args.timezone ?? DEFAULT_TIMEZONE;
    xJobService(x).recover(x);
    console.log(`[Cron] Using timezone: ${this.globalTimezone}`);
    for (const job of args.jobs) this.scheduleJob(x, job);
    console.log(`[Cron] Scheduler started with ${args.jobs.length} job(s) — croner`);
  }

  stop(_x: Context): void {
    for (const [name, job] of this.jobs) {
      job.stop();
      console.log(`Stopped cron job: ${name}`);
    }
    this.jobs.clear();
    this.jobConfigs.clear();
    this.onJob = undefined;
    this.onJobComplete = undefined;
  }

  private async shouldRunLegacyJob(job: LegacyCronJobConfig): Promise<boolean> {
    if (!job.precheckCommand) return true;
    try {
      const { stdout } = await execAsync(job.precheckCommand, {
        cwd: process.cwd(),
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      const out = stdout.trim().toLowerCase();
      if (["false", "0", "no", "skip", "no_reply"].includes(out)) return false;
      return ["true", "1", "yes", "run", ""].includes(out);
    } catch (error) {
      console.error(`[Cron] Legacy precheck failed for ${job.name}; skipping:`, error);
      return false;
    }
  }

  private async executeLegacyJob(job: LegacyCronJobConfig): Promise<void> {
    if (!(await this.shouldRunLegacyJob(job))) return;
    const sessionParts = job.session.split(":");
    const channelName = sessionParts[0] || "cron";
    const targetName = sessionParts.slice(1).join(":") || "default";
    const prompt = job.sendCondition
      ? `${job.prompt}\n\nIMPORTANT: After your analysis, if the following condition is NOT met, respond with exactly 'NO_REPLY' and nothing else. Condition: ${job.sendCondition}`
      : job.prompt;
    const event: InboundEvent = {
      sessionKey: job.session,
      channel: channelName,
      target: targetName,
      author: "system",
      timestamp: Date.now(),
      content: prompt,
      raw: {
        cronJob: job.name,
        sendCondition: job.sendCondition || null,
        deliveryKey: `cron:${job.name}:${randomUUID()}`,
      },
    };
    if (!this.onJob) throw new Error("Cron service has not been started");
    await this.onJob(event, channelName);
  }

  private isISODate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
  }

  private calculateNextScriptRun(job: ScriptJobConfig): string | null {
    if ("at" in job.schedule)
      return resolveJobTime(job.schedule.at, job.schedule.timezone ?? "America/Toronto");
    const cron = new Cron(job.schedule.cron, {
      paused: true,
      timezone: this.getJobTimezone(job),
    });
    const next = cron.nextRun();
    cron.stop();
    return next?.toISOString() ?? null;
  }

  private readOrInitializeNextRun(x: Context, job: ScriptJobConfig): string | null {
    const db = xDb(x);
    // The effective timezone is part of the schedule even when omitted by the job.
    const config = JSON.stringify({ schedule: job.schedule, timezone: this.getJobTimezone(job) });
    const row = db
      .prepare("SELECT config, next_at FROM job_schedule_state WHERE name = ?")
      .get(job.name) as { config: string; next_at: string | null } | undefined;
    if (row?.config === config) return row.next_at;
    const nextAt = this.calculateNextScriptRun(job);
    db.prepare(
      `INSERT INTO job_schedule_state(name, config, next_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET config = excluded.config, next_at = excluded.next_at`,
    ).run(job.name, config, nextAt);
    return nextAt;
  }

  private advanceScriptSchedule(x: Context, job: ScriptJobConfig): void {
    const nextAt = "at" in job.schedule ? null : this.calculateNextScriptRun(job);
    xDb(x)
      .prepare("UPDATE job_schedule_state SET next_at = ? WHERE name = ?")
      .run(nextAt, job.name);
  }

  private scheduleScriptJob(x: Context, job: ScriptJobConfig): void {
    this.jobConfigs.set(job.name, job);
    if (!job.enabled) return;
    const nextAt = this.readOrInitializeNextRun(x, job);
    if (!nextAt) return;
    const scheduledAt = nextAt;
    // Relative wakeups cannot silently expire during timer construction. Recheck
    // wall time on every wake, including after sleep or a clock adjustment.
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const due = new Date(nextAt);
    const handle = {
      stop: () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      },
      isRunning: () => !stopped,
      nextRun: () => (stopped ? null : due),
    };
    const current = () => !stopped && this.jobs.get(job.name) === handle;
    const arm = () => {
      if (!current()) return;
      timer = setTimeout(
        () => {
          void wake();
        },
        Math.max(1, Math.min(30_000, due.getTime() - Date.now())),
      );
    };
    const wake = async () => {
      if (!current() || running) return;
      if (Date.now() < due.getTime()) {
        arm();
        return;
      }
      running = true;
      try {
        // Preserve uncertain-side-effect protection: advance before executing.
        this.advanceScriptSchedule(x, job);
        await xJobService(x).execute(x, job, scheduledAt);
      } catch (error) {
        console.error(`[Jobs] ${job.name} failed before a run outcome was saved:`, error);
      } finally {
        // Handle identity is the generation token. A stale completion must not
        // delete or rearm a replacement created by reload, pause, or timezone change.
        if (current()) {
          handle.stop();
          this.jobs.delete(job.name);
          if (this.jobConfigs.get(job.name) === job && "cron" in job.schedule && job.enabled) {
            this.scheduleScriptJob(x, job);
          }
        }
      }
    };
    this.jobs.set(job.name, handle);
    arm();
  }

  private scheduleLegacyJob(x: Context, job: LegacyCronJobConfig): void {
    const timezone = this.getJobTimezone(job);
    let pattern: string | Date = job.schedule;
    if (this.isISODate(job.schedule)) {
      const target = new Date(job.schedule);
      if (target.getTime() <= Date.now()) return;
      pattern = target;
    }
    const cron = new Cron(
      pattern,
      {
        timezone,
        maxRuns: job.oneTime || this.isISODate(job.schedule) ? 1 : undefined,
      },
      async () => {
        try {
          await this.executeLegacyJob(job);
        } catch (error) {
          console.error(`[Cron] Legacy job ${job.name} failed:`, error);
        }
        if (job.oneTime || this.isISODate(job.schedule)) {
          this.jobs.delete(job.name);
          this.jobConfigs.delete(job.name);
          await this.onJobComplete?.(job.name);
        }
      },
    );
    this.jobs.set(job.name, cron);
    this.jobConfigs.set(job.name, job);
  }

  scheduleJob(x: Context, job: CronJobConfig): void {
    if (this.jobs.has(job.name)) return;
    try {
      if (isScriptJob(job)) this.scheduleScriptJob(x, job);
      else this.scheduleLegacyJob(x, job);
    } catch (error) {
      console.error(`Invalid schedule for job ${job.name}:`, error);
    }
  }

  private unscheduleJob(x: Context, name: string, deleteState: boolean): boolean {
    const scheduled = this.jobs.get(name);
    const configured = this.jobConfigs.has(name);
    scheduled?.stop();
    this.jobs.delete(name);
    this.jobConfigs.delete(name);
    if (deleteState) xDb(x).prepare("DELETE FROM job_schedule_state WHERE name = ?").run(name);
    return Boolean(scheduled || configured);
  }

  removeJob(x: Context, name: string): boolean {
    return this.unscheduleJob(x, name, true);
  }

  checkHealth(_x: Context): CronHealth[] {
    return [...this.jobConfigs].map(([name]) => {
      const scheduled = this.jobs.get(name);
      return {
        name,
        isActive: scheduled?.isRunning() ?? false,
        nextRun: scheduled?.nextRun() ?? null,
      };
    });
  }

  async triggerJob(x: Context, name: string): Promise<boolean> {
    const job = this.jobConfigs.get(name);
    if (!job) return false;
    if (isScriptJob(job)) {
      void xJobService(x)
        .execute(x, job, new Date().toISOString())
        .catch((error) => console.error(`[Jobs] Manual run ${job.name} failed:`, error));
    } else {
      await this.executeLegacyJob(job);
    }
    return true;
  }

  reload(x: Context, jobs: CronJobConfig[], timezone?: string): void {
    this.setTimezone(timezone ?? DEFAULT_TIMEZONE);
    const nextByName = new Map(jobs.map((job) => [job.name, job]));
    for (const [name, current] of [...this.jobConfigs]) {
      const next = nextByName.get(name);
      if (!next) {
        this.removeJob(x, name);
      } else if (JSON.stringify(current) !== JSON.stringify(next)) {
        this.unscheduleJob(x, name, false);
        this.scheduleJob(x, next);
      }
    }
    for (const job of jobs) {
      if (!this.jobConfigs.has(job.name)) this.scheduleJob(x, job);
    }
  }
}
