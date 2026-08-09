import type { Context } from "../../context/Context.js";
import type { CronScheduler } from "../../cron/scheduler.js";
import type { ChannelService } from "../channels/ChannelService.js";
import type { CronJobConfig, InboundEvent, VitoConfig } from "../../types.js";

export interface AskOptions {
  question: string;
  session?: string;
  author?: string;
  channelPrompt?: string;
  timeoutMs?: number | null;
  relayToSession?: boolean;
}

/** Process-lifetime coordinator for channels, queues, cron, and live Pi sessions. */
export interface OrchestratorService {
  registerChannel(x: Context, channel: ChannelService, channelX?: Context): void;
  getCronScheduler(x: Context): CronScheduler;
  reloadCronJobs(x: Context, jobs: CronJobConfig[], timezone?: string): void;
  reloadConfig(x: Context, config: VitoConfig): void;
  handleInbound(x: Context, event: InboundEvent, channel: ChannelService | null): Promise<void>;
  ask(x: Context, options: AskOptions): Promise<string>;
  start(x: Context): Promise<void>;
  stop(x: Context): Promise<void>;
}
