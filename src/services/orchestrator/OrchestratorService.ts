import type { Context } from "../../context/Context.js";
import type { ChannelService } from "../channels/ChannelService.js";
import type { InboundEvent } from "../../lib/types/inbound-event.js";
import type { CronJobConfig, VitoConfig } from "../../shared/schemas/vito-config.js";

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
  reloadCronJobs(x: Context, jobs: CronJobConfig[], timezone?: string): void;
  reloadConfig(x: Context, config: VitoConfig): void;
  handleInbound(x: Context, event: InboundEvent, channel: ChannelService | null): Promise<void>;
  ask(x: Context, options: AskOptions): Promise<string>;
  start(x: Context): Promise<void>;
  stop(x: Context): Promise<void>;
}
