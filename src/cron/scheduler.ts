import { parseCronExpression } from "cron-schedule";
import { IntervalBasedCronScheduler } from "cron-schedule/schedulers/interval-based.js";
import type { CronJobConfig, InboundEvent } from "../types.js";
import { DEFAULT_TIMEZONE } from "../system-instructions.js";

export class CronScheduler {
  private scheduler: IntervalBasedCronScheduler;
  private taskIds = new Map<string, number>(); // job name -> scheduler task id
  private timeouts = new Map<string, ReturnType<typeof setTimeout>>(); // for ISO date one-time jobs
  private jobConfigs = new Map<string, CronJobConfig>();
  private globalTimezone: string = DEFAULT_TIMEZONE;

  constructor(
    private onJob: (event: InboundEvent, channelName: string | null) => Promise<void>,
    private onJobComplete?: (jobName: string) => Promise<void>
  ) {
    // Interval-based: checks every 60 seconds for due jobs
    // This is the reliable approach — no single setTimeout that can get lost
    this.scheduler = new IntervalBasedCronScheduler(60 * 1000);
  }

  /** Set the global timezone (from config) */
  setTimezone(tz: string): void {
    this.globalTimezone = tz;
    console.log(`[Cron] Global timezone set to: ${tz}`);
  }

  /** Get the effective timezone for a job (job-specific > global > default) */
  private getJobTimezone(job: CronJobConfig): string {
    return job.timezone || this.globalTimezone || DEFAULT_TIMEZONE;
  }

  /** Start all jobs from config */
  start(jobs: CronJobConfig[], globalTimezone?: string): void {
    if (globalTimezone) {
      this.globalTimezone = globalTimezone;
      console.log(`[Cron] Using timezone: ${globalTimezone}`);
    }
    for (const job of jobs) {
      this.scheduleJob(job);
    }
    console.log(`[Cron] Scheduler started with ${jobs.length} job(s) — interval-based (cron-schedule)`);
  }

  /** Stop all running jobs */
  stop(): void {
    for (const [name, taskId] of this.taskIds) {
      this.scheduler.unregisterTask(taskId);
      console.log(`Stopped cron job: ${name}`);
    }
    this.scheduler.stop();

    for (const [name, timeout] of this.timeouts) {
      clearTimeout(timeout);
      console.log(`Stopped one-time job: ${name}`);
    }

    this.taskIds.clear();
    this.timeouts.clear();
  }

  /** Execute a job */
  private async executeJob(job: CronJobConfig): Promise<void> {
    // Extract channel and target from session (e.g., "dashboard:default" -> channel="dashboard", target="default")
    const sessionParts = job.session.split(":");
    const channelName = sessionParts[0] || "cron";
    const targetName = sessionParts.slice(1).join(":") || "default";

    // If sendCondition is set, modify the prompt to include the instruction
    let prompt = job.prompt;
    if (job.sendCondition) {
      prompt = `${job.prompt}\n\nIMPORTANT: After your analysis, if the following condition is NOT met, respond with exactly 'NO_REPLY' and nothing else. Condition: ${job.sendCondition}`;
    }

    // Create an InboundEvent from the cron job
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
      },
    };

    try {
      await this.onJob(event, channelName);
    } catch (err) {
      console.error(`[Cron] Job ${job.name} failed:`, err);
    }
  }

  /** Check if a string is an ISO date */
  private isISODate(str: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str);
  }

  /** Schedule a single job */
  scheduleJob(job: CronJobConfig): void {
    if (this.taskIds.has(job.name) || this.timeouts.has(job.name)) {
      console.warn(`Cron job already exists: ${job.name}`);
      return;
    }

    // Handle ISO date strings for one-time jobs using setTimeout
    if (this.isISODate(job.schedule)) {
      const targetTime = new Date(job.schedule).getTime();
      const now = Date.now();
      const delay = targetTime - now;

      if (delay <= 0) {
        console.warn(`[Cron] One-time job ${job.name} scheduled for the past (${job.schedule}), skipping`);
        return;
      }

      const tz = this.getJobTimezone(job);
      console.log(`Scheduled one-time job: ${job.name} for ${job.schedule} [${tz}] (in ${Math.round(delay / 1000)}s)`);

      const timeout = setTimeout(async () => {
        console.log(`[Cron] Triggering one-time job: ${job.name}`);
        await this.executeJob(job);

        // Clean up
        this.timeouts.delete(job.name);
        this.jobConfigs.delete(job.name);

        // Notify the orchestrator to remove it from config file
        if (this.onJobComplete) {
          await this.onJobComplete(job.name);
        }
      }, delay);

      this.timeouts.set(job.name, timeout);
      this.jobConfigs.set(job.name, job);
      return;
    }

    // Parse the cron expression
    // Note: cron-schedule uses system timezone. For cross-TZ scheduling,
    // set TZ env var or use per-job timezone field (TODO: full timezone support)
    const tz = this.getJobTimezone(job);
    let cron;
    try {
      cron = parseCronExpression(job.schedule);
    } catch (err) {
      console.error(`Invalid cron schedule for job ${job.name}: ${job.schedule}`, err);
      return;
    }

    // Register with the interval-based scheduler
    const taskId = this.scheduler.registerTask(
      cron,
      async () => {
        console.log(`[Cron] Triggering job: ${job.name}${job.oneTime ? " (one-time)" : ""}`);
        await this.executeJob(job);

        // If this is a one-time job, remove it after successful execution
        if (job.oneTime) {
          console.log(`[Cron] One-time job completed: ${job.name}, removing...`);
          this.removeJob(job.name);
          this.jobConfigs.delete(job.name);

          // Notify the orchestrator to remove it from config file
          if (this.onJobComplete) {
            await this.onJobComplete(job.name);
          }
        }
      },
      {
        isOneTimeTask: job.oneTime || false,
        errorHandler: (err) => {
          console.error(`[Cron] Error in job ${job.name}:`, err);
        },
      }
    );

    this.taskIds.set(job.name, taskId);
    this.jobConfigs.set(job.name, job);
    console.log(`Scheduled cron job: ${job.name} (${job.schedule}) [${tz}]${job.oneTime ? " [ONE-TIME]" : ""}`);
  }

  /** Remove a job by name */
  removeJob(name: string): boolean {
    const taskId = this.taskIds.get(name);
    const timeout = this.timeouts.get(name);

    if (taskId === undefined && !timeout) return false;

    if (taskId !== undefined) {
      this.scheduler.unregisterTask(taskId);
      this.taskIds.delete(name);
    }
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(name);
    }

    this.jobConfigs.delete(name);
    console.log(`Removed cron job: ${name}`);
    return true;
  }

  /** Get all active job names */
  getActiveJobs(): string[] {
    return [...this.taskIds.keys(), ...this.timeouts.keys()];
  }

  /** Check health of all scheduled tasks */
  checkHealth(): { name: string; isActive: boolean; nextRun: Date | null }[] {
    const results: { name: string; isActive: boolean; nextRun: Date | null }[] = [];
    
    for (const [name] of this.taskIds) {
      const job = this.jobConfigs.get(name);
      let nextRun: Date | null = null;
      if (job) {
        try {
          const cron = parseCronExpression(job.schedule);
          nextRun = cron.getNextDate();
        } catch { /* ignore */ }
      }
      results.push({ name, isActive: true, nextRun });
    }

    for (const [name] of this.timeouts) {
      const job = this.jobConfigs.get(name);
      let nextRun: Date | null = null;
      if (job && this.isISODate(job.schedule)) {
        nextRun = new Date(job.schedule);
      }
      results.push({ name, isActive: true, nextRun });
    }

    return results;
  }

  /** Manually trigger a job by name */
  async triggerJob(name: string): Promise<boolean> {
    const job = this.jobConfigs.get(name);
    if (!job) {
      console.log(`[Cron] Cannot trigger job '${name}' — not found`);
      return false;
    }

    console.log(`[Cron] Manually triggering job: ${name}`);
    await this.executeJob(job);
    return true;
  }

  /** Reload jobs - remove old ones, add new ones, update changed ones */
  reload(jobs: CronJobConfig[]): void {
    const newJobNames = new Set(jobs.map((j) => j.name));
    const currentJobNames = new Set([...this.taskIds.keys(), ...this.timeouts.keys()]);

    // Remove jobs that no longer exist in config
    for (const name of currentJobNames) {
      if (!newJobNames.has(name)) {
        this.removeJob(name);
      }
    }

    // Add or update jobs
    for (const job of jobs) {
      const existingTask = this.taskIds.has(job.name) || this.timeouts.has(job.name);
      if (existingTask) {
        // Stop and reschedule if it exists (in case schedule/prompt changed)
        this.removeJob(job.name);
      }
      this.scheduleJob(job);
    }

    console.log(`Cron jobs reloaded: ${jobs.length} active job(s)`);
  }
}
