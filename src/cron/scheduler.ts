import cron from "node-cron";
import type { CronJobConfig, InboundEvent } from "../types.js";

export class CronScheduler {
  private tasks = new Map<string, cron.ScheduledTask>();
  private timeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private jobConfigs = new Map<string, CronJobConfig>();

  constructor(
    private onJob: (event: InboundEvent, channelName: string | null) => Promise<void>,
    private onJobComplete?: (jobName: string) => Promise<void>
  ) {}

  /** Start all jobs from config */
  start(jobs: CronJobConfig[]): void {
    for (const job of jobs) {
      this.scheduleJob(job);
    }
    console.log(`Cron scheduler started with ${jobs.length} job(s)`);
  }

  /** Stop all running jobs */
  stop(): void {
    for (const [name, task] of this.tasks) {
      task.stop();
      console.log(`Stopped cron job: ${name}`);
    }
    for (const [name, timeout] of this.timeouts) {
      clearTimeout(timeout);
      console.log(`Stopped one-time job: ${name}`);
    }
    this.tasks.clear();
    this.timeouts.clear();
  }

  /** Execute a job (shared by cron and setTimeout) */
  private async executeJob(job: CronJobConfig): Promise<void> {
    // Extract channel and target from session (e.g., "dashboard:default" -> channel="dashboard", target="default")
    const sessionParts = job.session.split(":");
    const channelName = sessionParts[0] || "cron";
    const targetName = sessionParts.slice(1).join(":") || "default";
    
    // Create an InboundEvent from the cron job
    const event: InboundEvent = {
      sessionKey: job.session,
      channel: channelName,
      target: targetName,
      author: "system",
      timestamp: Date.now(),
      content: job.prompt,
      raw: { cronJob: job.name },
    };

    try {
      await this.onJob(event, channelName);
    } catch (err) {
      console.error(`[Cron] Job ${job.name} failed:`, err);
    }
  }

  /** Check if a string is an ISO date */
  private isISODate(str: string): boolean {
    // Match ISO 8601 format: 2026-02-15T08:00:00-05:00 or 2026-02-15T13:00:00Z
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str);
  }

  /** Schedule a single job */
  scheduleJob(job: CronJobConfig): void {
    if (this.tasks.has(job.name) || this.timeouts.has(job.name)) {
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

      console.log(`Scheduled one-time job: ${job.name} for ${job.schedule} (in ${Math.round(delay / 1000)}s)`);

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

    if (!cron.validate(job.schedule)) {
      console.error(`Invalid cron schedule for job ${job.name}: ${job.schedule}`);
      return;
    }

    const task = cron.schedule(
      job.schedule,
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
        timezone: job.timezone || "America/New_York",
      }
    );

    this.tasks.set(job.name, task);
    this.jobConfigs.set(job.name, job);
    console.log(`Scheduled cron job: ${job.name} (${job.schedule})${job.oneTime ? " [ONE-TIME]" : ""}`);
  }

  /** Remove a job by name */
  removeJob(name: string): boolean {
    const task = this.tasks.get(name);
    const timeout = this.timeouts.get(name);
    
    if (!task && !timeout) return false;

    if (task) {
      task.stop();
      this.tasks.delete(name);
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
    return Array.from(this.tasks.keys());
  }

  /** Reload jobs - remove old ones, add new ones, update changed ones */
  reload(jobs: CronJobConfig[]): void {
    const newJobNames = new Set(jobs.map((j) => j.name));
    const currentJobNames = new Set([...this.tasks.keys(), ...this.timeouts.keys()]);

    // Remove jobs that no longer exist in config
    for (const name of currentJobNames) {
      if (!newJobNames.has(name)) {
        this.removeJob(name);
      }
    }

    // Add or update jobs
    for (const job of jobs) {
      const existingTask = this.tasks.has(job.name) || this.timeouts.has(job.name);
      if (existingTask) {
        // Stop and reschedule if it exists (in case schedule/prompt changed)
        this.removeJob(job.name);
      }
      this.scheduleJob(job);
    }

    console.log(`Cron jobs reloaded: ${jobs.length} active job(s)`);
  }
}
