import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Cron } from "croner";
import type { Context } from "../../context/Context.js";
import { DEFAULT_TIMEZONE } from "../../shared/defaults.js";
import type { InboundEvent } from "../../lib/types/inbound-event.js";
import type { CronJobConfig } from "../../shared/schemas/vito-config.js";
import type { CronHealth, CronService, StartCronArgs } from "./CronService.js";

const execAsync = promisify(exec);

export class CronerCronService implements CronService {
  private readonly jobs = new Map<string, Cron>();
  private readonly jobConfigs = new Map<string, CronJobConfig>();
  private globalTimezone = DEFAULT_TIMEZONE;
  private onJob?: (event: InboundEvent, channelName: string | null) => Promise<void>;
  private onJobComplete?: (jobName: string) => Promise<void>;

  /** Set the global timezone (from config) */
  private setTimezone(tz: string): void {
    this.globalTimezone = tz;
    console.log(`[Cron] Global timezone set to: ${tz}`);
  }

  /** Get the effective timezone for a job (job-specific > global > default) */
  private getJobTimezone(job: CronJobConfig): string {
    return job.timezone || this.globalTimezone || DEFAULT_TIMEZONE;
  }

  getScheduleError(_x: Context, job: CronJobConfig, globalTimezone?: string): string | null {
    const timezone = job.timezone || globalTimezone || DEFAULT_TIMEZONE;
    if (this.isISODate(job.schedule)) {
      const date = new Date(job.schedule);
      if (Number.isNaN(date.getTime())) return "Invalid ISO date schedule";
      if (date.getTime() <= Date.now()) return "One-time schedule must be in the future";
      return null;
    }

    try {
      const cron = new Cron(job.schedule, { paused: true, timezone }, () => {});
      cron.stop();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid cron schedule";
    }
  }

  /** Start all jobs from config and connect them to the application event sink. */
  start(x: Context, args: StartCronArgs): void {
    this.stop(x);
    this.onJob = args.onJob;
    this.onJobComplete = args.onJobComplete;
    this.globalTimezone = args.timezone ?? DEFAULT_TIMEZONE;
    console.log(`[Cron] Using timezone: ${this.globalTimezone}`);
    for (const job of args.jobs) {
      this.scheduleJob(x, job);
    }
    console.log(
      `[Cron] Scheduler started with ${args.jobs.length} job(s) — croner (with timezone support)`,
    );
  }

  /** Stop all running jobs. */
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

  /** Run an optional deterministic precheck before spending AI tokens. */
  private async shouldRunJob(jobConfig: CronJobConfig): Promise<boolean> {
    if (!jobConfig.precheckCommand) return true;

    try {
      const { stdout } = await execAsync(jobConfig.precheckCommand, {
        cwd: process.cwd(),
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      const out = stdout.trim().toLowerCase();
      if (["false", "0", "no", "skip", "no_reply"].includes(out)) {
        console.log(`[Cron] Precheck skipped job: ${jobConfig.name}`);
        return false;
      }
      if (["true", "1", "yes", "run"].includes(out) || out === "") {
        console.log(`[Cron] Precheck passed job: ${jobConfig.name}${out ? ` (${out})` : ""}`);
        return true;
      }
      console.log(
        `[Cron] Precheck output for ${jobConfig.name}: ${out.slice(0, 200)} — not an explicit pass, skipping`,
      );
      return false;
    } catch (err: unknown) {
      console.error(
        `[Cron] Precheck failed for ${jobConfig.name}; skipping job to avoid burning AI tokens:`,
        err,
      );
      return false;
    }
  }

  /** Execute a job */
  private async executeJob(jobConfig: CronJobConfig): Promise<void> {
    if (!(await this.shouldRunJob(jobConfig))) return;
    // Extract channel and target from session (e.g., "dashboard:default" -> channel="dashboard", target="default")
    const sessionParts = jobConfig.session.split(":");
    const channelName = sessionParts[0] || "cron";
    const targetName = sessionParts.slice(1).join(":") || "default";

    // If sendCondition is set, modify the prompt to include the instruction
    let prompt = jobConfig.prompt;
    if (jobConfig.sendCondition) {
      prompt = `${jobConfig.prompt}\n\nIMPORTANT: After your analysis, if the following condition is NOT met, respond with exactly 'NO_REPLY' and nothing else. Condition: ${jobConfig.sendCondition}`;
    }

    // Create an InboundEvent from the cron job
    const event: InboundEvent = {
      sessionKey: jobConfig.session,
      channel: channelName,
      target: targetName,
      author: "system",
      timestamp: Date.now(),
      content: prompt,
      raw: {
        cronJob: jobConfig.name,
        sendCondition: jobConfig.sendCondition || null,
      },
    };

    try {
      if (!this.onJob) throw new Error("Cron service has not been started");
      await this.onJob(event, channelName);
    } catch (err) {
      console.error(`[Cron] Job ${jobConfig.name} failed:`, err);
    }
  }

  /** Check if a string is an ISO date */
  private isISODate(str: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str);
  }

  /** Schedule a single job. */
  scheduleJob(x: Context, jobConfig: CronJobConfig): void {
    if (this.jobs.has(jobConfig.name)) {
      console.warn(`Cron job already exists: ${jobConfig.name}`);
      return;
    }

    const tz = this.getJobTimezone(jobConfig);
    let pattern: string | Date = jobConfig.schedule;

    // Handle ISO date strings for one-time jobs
    if (this.isISODate(jobConfig.schedule)) {
      const targetTime = new Date(jobConfig.schedule);
      if (targetTime.getTime() <= Date.now()) {
        console.warn(
          `[Cron] One-time job ${jobConfig.name} scheduled for the past (${jobConfig.schedule}), skipping`,
        );
        return;
      }
      pattern = targetTime;
    }

    try {
      const cronJob = new Cron(
        pattern,
        {
          timezone: tz,
          maxRuns: jobConfig.oneTime || this.isISODate(jobConfig.schedule) ? 1 : undefined,
        },
        async () => {
          console.log(
            `[Cron] Triggering job: ${jobConfig.name}${jobConfig.oneTime ? " (one-time)" : ""}`,
          );
          await this.executeJob(jobConfig);

          // If this is a one-time job, clean up and notify
          if (jobConfig.oneTime || this.isISODate(jobConfig.schedule)) {
            console.log(`[Cron] One-time job completed: ${jobConfig.name}, removing...`);
            this.jobs.delete(jobConfig.name);
            this.jobConfigs.delete(jobConfig.name);

            // Notify the orchestrator to remove it from config file
            if (this.onJobComplete) {
              await this.onJobComplete(jobConfig.name);
            }
          }
        },
      );

      this.jobs.set(jobConfig.name, cronJob);
      this.jobConfigs.set(jobConfig.name, jobConfig);

      const nextRun = cronJob.nextRun();
      const nextRunStr = nextRun ? nextRun.toLocaleString("en-US", { timeZone: tz }) : "N/A";
      console.log(
        `Scheduled cron job: ${jobConfig.name} (${jobConfig.schedule}) [${tz}]${jobConfig.oneTime ? " [ONE-TIME]" : ""}${jobConfig.precheckCommand ? " [PRECHECK]" : ""} — next run: ${nextRunStr}`,
      );
      if (jobConfig.precheckCommand) {
        console.log(`[Cron] Precheck for ${jobConfig.name}: ${jobConfig.precheckCommand}`);
      }
    } catch (err) {
      console.error(`Invalid cron schedule for job ${jobConfig.name}: ${jobConfig.schedule}`, err);
    }
  }

  /** Remove a job by name. */
  removeJob(_x: Context, name: string): boolean {
    const job = this.jobs.get(name);
    if (!job) return false;

    job.stop();
    this.jobs.delete(name);
    this.jobConfigs.delete(name);
    console.log(`Removed cron job: ${name}`);
    return true;
  }

  /** Get all active job names */
  getActiveJobs(): string[] {
    return [...this.jobs.keys()];
  }

  /** Check health of all scheduled tasks. */
  checkHealth(_x: Context): CronHealth[] {
    const results: CronHealth[] = [];

    for (const [name, job] of this.jobs) {
      results.push({
        name,
        isActive: job.isRunning(),
        nextRun: job.nextRun(),
      });
    }

    return results;
  }

  /** Manually trigger a job by name. */
  async triggerJob(_x: Context, name: string): Promise<boolean> {
    const jobConfig = this.jobConfigs.get(name);
    if (!jobConfig) {
      console.log(`[Cron] Cannot trigger job '${name}' — not found`);
      return false;
    }

    console.log(`[Cron] Manually triggering job: ${name}`);
    await this.executeJob(jobConfig);
    return true;
  }

  /** Reload jobs, replacing changed schedules and preserving the event sink. */
  reload(x: Context, jobs: CronJobConfig[], timezone?: string): void {
    this.setTimezone(timezone ?? DEFAULT_TIMEZONE);
    const newJobNames = new Set(jobs.map((j) => j.name));
    const currentJobNames = new Set(this.jobs.keys());

    // Remove jobs that no longer exist in config
    for (const name of currentJobNames) {
      if (!newJobNames.has(name)) {
        this.removeJob(x, name);
      }
    }

    // Add or update jobs
    for (const jobConfig of jobs) {
      const existingJob = this.jobs.has(jobConfig.name);
      if (existingJob) {
        // Stop and reschedule if it exists (in case schedule/prompt changed)
        this.removeJob(x, jobConfig.name);
      }
      this.scheduleJob(x, jobConfig);
    }

    console.log(`Cron jobs reloaded: ${jobs.length} active job(s)`);
  }
}
