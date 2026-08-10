import type { Context } from "../../context/Context.js";
import type { InboundEvent } from "../../lib/types/inbound-event.js";
import type { CronJobConfig } from "../../shared/contracts/vito-config.js";

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
  getScheduleError(x: Context, job: CronJobConfig, globalTimezone?: string): string | null;
  scheduleJob(x: Context, job: CronJobConfig): void;
  removeJob(x: Context, name: string): boolean;
  triggerJob(x: Context, name: string): Promise<boolean>;
  checkHealth(x: Context): CronHealth[];
}
