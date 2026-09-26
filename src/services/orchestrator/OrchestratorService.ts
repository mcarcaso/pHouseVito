import type { SteerQueuedResult } from "./QueuedSteering.js";
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
  signal?: AbortSignal;
}

export interface ContextualPromptOptions {
  message: string;
  session: string;
  author?: string;
  signal?: AbortSignal;
}

/** Process-lifetime coordinator for channels, queues, cron, and live Pi sessions. */
export interface OrchestratorRun {
  sessionKey: string;
  channel: string;
  author: string;
  preview: string;
  status: "active" | "queued";
  timestamp: number;
  id?: string;
}

export interface OrchestratorService {
  registerChannel(x: Context, channel: ChannelService, channelX?: Context): void;
  reloadCronJobs(x: Context, jobs: CronJobConfig[], timezone?: string): void;
  reloadConfig(x: Context, config: VitoConfig): void;
  handleInbound(x: Context, event: InboundEvent, channel: ChannelService | null): Promise<void>;
  steer(x: Context, event: InboundEvent): Promise<boolean>;
  steerQueued(
    x: Context,
    sessionKey: string,
    id: string,
    authorId: string,
  ): Promise<SteerQueuedResult>;
  ask(x: Context, options: AskOptions): Promise<string>;
  prompt(x: Context, options: ContextualPromptOptions): Promise<string>;
  appendSessionContext(
    x: Context,
    sessionId: string,
    content: string,
    details: { key: string; source: string },
  ): Promise<void>;
  listRuns(x: Context): OrchestratorRun[];
  start(x: Context): Promise<void>;
  stop(x: Context): Promise<void>;
}
