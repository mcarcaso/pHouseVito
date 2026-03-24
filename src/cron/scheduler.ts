import { Cron } from "croner";
import type { CronJobConfig, InboundEvent } from "../types.js";
import { DEFAULT_TIMEZONE } from "../system-instructions.js";

export class CronScheduler {
  private jobs = new Map<string, Cron>(); // job name -> Cron instance
  private jobConfigs = new Map<string, CronJobConfig>();
  private globalTimezone: string = DEFAULT_TIMEZONE;

  constructor(
    private onJob: (event: InboundEvent, channelName: string | null) => Promise<void>,
    private onJobComplete?: (jobName: string) => Promise<void>
  ) {}

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
    console.log(`[Cron] Scheduler started with ${jobs.length} job(s) — croner (with timezone support)`);
  }

  /** Stop all running jobs */
  stop(): void {
    for (const [name, job] of this.jobs) {
      job.stop();
      console.log(`Stopped cron job: ${name}`);
    }
    this.jobs.clear();
    this.jobConfigs.clear();
  }

  /** Execute a job */
  private async executeJob(jobConfig: CronJobConfig): Promise<void> {
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
      await this.onJob(event, channelName);
    } catch (err) {
      console.error(`[Cron] Job ${jobConfig.name} failed:`, err);
    }
  }

  /** Check if a string is an ISO date */
  private isISODate(str: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str);
  }

  /** Schedule a single job */
  scheduleJob(jobConfig: CronJobConfig): void {
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
        console.warn(`[Cron] One-time job ${jobConfig.name} scheduled for the past (${jobConfig.schedule}), skipping`);
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
          console.log(`[Cron] Triggering job: ${jobConfig.name}${jobConfig.oneTime ? " (one-time)" : ""}`);
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
        }
      );

      this.jobs.set(jobConfig.name, cronJob);
      this.jobConfigs.set(jobConfig.name, jobConfig);

      const nextRun = cronJob.nextRun();
      const nextRunStr = nextRun ? nextRun.toLocaleString("en-US", { timeZone: tz }) : "N/A";
      console.log(
        `Scheduled cron job: ${jobConfig.name} (${jobConfig.schedule}) [${tz}]${jobConfig.oneTime ? " [ONE-TIME]" : ""} — next run: ${nextRunStr}`
      );
    } catch (err) {
      console.error(`Invalid cron schedule for job ${jobConfig.name}: ${jobConfig.schedule}`, err);
    }
  }

  /** Remove a job by name */
  removeJob(name: string): boolean {
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

  /** Check health of all scheduled tasks */
  checkHealth(): { name: string; isActive: boolean; nextRun: Date | null }[] {
    const results: { name: string; isActive: boolean; nextRun: Date | null }[] = [];

    for (const [name, job] of this.jobs) {
      results.push({
        name,
        isActive: job.isRunning(),
        nextRun: job.nextRun(),
      });
    }

    return results;
  }

  /** Manually trigger a job by name */
  async triggerJob(name: string): Promise<boolean> {
    const jobConfig = this.jobConfigs.get(name);
    if (!jobConfig) {
      console.log(`[Cron] Cannot trigger job '${name}' — not found`);
      return false;
    }

    console.log(`[Cron] Manually triggering job: ${name}`);
    await this.executeJob(jobConfig);
    return true;
  }

  /** Reload jobs - remove old ones, add new ones, update changed ones */
  reload(jobs: CronJobConfig[]): void {
    const newJobNames = new Set(jobs.map((j) => j.name));
    const currentJobNames = new Set(this.jobs.keys());

    // Remove jobs that no longer exist in config
    for (const name of currentJobNames) {
      if (!newJobNames.has(name)) {
        this.removeJob(name);
      }
    }

    // Add or update jobs
    for (const jobConfig of jobs) {
      const existingJob = this.jobs.has(jobConfig.name);
      if (existingJob) {
        // Stop and reschedule if it exists (in case schedule/prompt changed)
        this.removeJob(jobConfig.name);
      }
      this.scheduleJob(jobConfig);
    }

    console.log(`Cron jobs reloaded: ${jobs.length} active job(s)`);
  }
}
