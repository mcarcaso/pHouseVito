import type { Context } from "../../context/Context.js";
import type { DashboardChatRequest } from "../../shared/contracts/dashboard-chat.js";
import type { InboundEvent } from "../../contracts/inbound-event.js";

export type DashboardInboundHandler = (event: InboundEvent) => void;

export interface DashboardChatService {
  configure(x: Context, handler: DashboardInboundHandler | undefined): void;
  isConfigured(x: Context): boolean;
  send(x: Context, message: DashboardChatRequest): boolean;
}
