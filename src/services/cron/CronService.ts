import type { Context } from "../../context/Context.js";
import type { CronJobConfig, InboundEvent } from "../../types.js";

export interface CronHealth {
  name: string;
  isActive: boolean;
  nextRun: Date | null;
}

export interface StartCronArgs {
  jobs: CronJobConfig[];
  timezone?: string;
  onJob: (event: InboundEvent, channelName: string | null) => Promise<void>;
  onJobComplete?: (jobName: string) => Promise<void>;
}

export interface CronService {
  start(x: Context, args: StartCronArgs): void;
  stop(x: Context): void;
  reload(x: Context, jobs: CronJobConfig[], timezone?: string): void;
  scheduleJob(x: Context, job: CronJobConfig): void;
  removeJob(x: Context, name: string): boolean;
  triggerJob(x: Context, name: string): Promise<boolean>;
  checkHealth(x: Context): CronHealth[];
}
