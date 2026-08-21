import type { Context } from "../../context/Context.js";
import type { DashboardChatRequest } from "../../shared/schemas/dashboard-chat.js";
import type { InboundEvent } from "../../lib/types/inbound-event.js";

export type DashboardInboundHandler = (event: InboundEvent) => void;

export interface DashboardChatService {
  configure(x: Context, handler: DashboardInboundHandler | undefined): void;
  isConfigured(x: Context): boolean;
  send(x: Context, message: DashboardChatRequest): boolean;
}
