import type { Context } from "../../context/Context.js";
import type { CronScheduler } from "../../cron/scheduler.js";
import type { CronJobConfig } from "../../types.js";
import type { CronHealth, CronService } from "./CronService.js";

export class CronSchedulerService implements CronService {
  constructor(private readonly scheduler: CronScheduler) {}

  scheduleJob(_x: Context, job: CronJobConfig): void {
    this.scheduler.scheduleJob(job);
  }

  removeJob(_x: Context, name: string): boolean {
    return this.scheduler.removeJob(name);
  }

  triggerJob(_x: Context, name: string): Promise<boolean> {
    return this.scheduler.triggerJob(name);
  }

  checkHealth(_x: Context): CronHealth[] {
    return this.scheduler.checkHealth();
  }
}
