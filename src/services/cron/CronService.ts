import type { Context } from "../../context/Context.js";
import type { CronJobConfig } from "../../types.js";

export interface CronHealth {
  name: string;
  isActive: boolean;
  nextRun: Date | null;
}

export interface CronService {
  scheduleJob(x: Context, job: CronJobConfig): void;
  removeJob(x: Context, name: string): boolean;
  triggerJob(x: Context, name: string): Promise<boolean>;
  checkHealth(x: Context): CronHealth[];
}
