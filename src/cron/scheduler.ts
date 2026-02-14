import cron from "node-cron";
import type { CronJobConfig, InboundEvent } from "../types.js";

export class CronScheduler {
  private tasks = new Map<string, cron.ScheduledTask>();
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
    this.tasks.clear();
  }

  /** Schedule a single job */
  scheduleJob(job: CronJobConfig): void {
    if (this.tasks.has(job.name)) {
      console.warn(`Cron job already exists: ${job.name}`);
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
        } catch (err) {
          console.error(`[Cron] Job ${job.name} failed:`, err);
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
    if (!task) return false;

    task.stop();
    this.tasks.delete(name);
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
    const currentJobNames = new Set(this.tasks.keys());

    // Remove jobs that no longer exist in config
    for (const name of currentJobNames) {
      if (!newJobNames.has(name)) {
        this.removeJob(name);
      }
    }

    // Add or update jobs
    for (const job of jobs) {
      const existingTask = this.tasks.get(job.name);
      if (existingTask) {
        // Stop and reschedule if it exists (in case schedule/prompt changed)
        this.removeJob(job.name);
      }
      this.scheduleJob(job);
    }

    console.log(`Cron jobs reloaded: ${jobs.length} active job(s)`);
  }
}
