import type { Context } from "../../context/Context.js";
import type { OutputHandler } from "../../output/OutputHandler.js";
import type { InboundEvent } from "../../contracts/inbound-event.js";
import type { SessionRow } from "../../stores/sessions/SessionStore.js";

export interface ChannelCapabilities {
  typing: boolean;
  reactions: boolean;
  attachments: boolean;
  streaming: boolean;
}

export type InboundEventHandler = (event: InboundEvent) => void;
export type ChannelUnsubscribe = () => void;

export interface CommandRegistrationResult {
  success: boolean;
  count: number;
  error?: string;
}

/** Optional administrative operations exposed by externally managed channels. */
export interface ChannelManagement {
  registerCommands(x: Context): Promise<CommandRegistrationResult>;
  resolveSessionAlias(
    x: Context,
    session: SessionRow
  ): Promise<string | undefined>;
}

/**
 * A transport boundary between Vito and one messaging surface.
 *
 * Implementations own SDK lifecycle and platform-specific event/output mapping.
 * Runtime dependencies and current configuration are resolved from the context
 * passed to each operation.
 */
export interface ChannelService {
  readonly name: string;
  readonly capabilities: ChannelCapabilities;
  readonly management?: ChannelManagement;

  start(x: Context): Promise<void>;
  stop(x: Context): Promise<void>;
  listen(x: Context, onEvent: InboundEventHandler): Promise<ChannelUnsubscribe>;
  createOutputHandler(x: Context, event: InboundEvent): OutputHandler;
  getCustomPrompt?(x: Context): string;
}
