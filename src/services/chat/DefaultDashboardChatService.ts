import type { Context } from "../../context/Context.js";
import type { DashboardChatRequest } from "../../shared/schemas/dashboard-chat.js";
import type { InboundEvent } from "../../lib/types/inbound-event.js";
import type { DashboardChatService, DashboardInboundHandler } from "./DashboardChatService.js";

export class DefaultDashboardChatService implements DashboardChatService {
  private handler?: DashboardInboundHandler;

  configure(_x: Context, handler: DashboardInboundHandler | undefined): void {
    this.handler = handler;
  }

  isConfigured(_x: Context): boolean {
    return this.handler !== undefined;
  }

  send(_x: Context, message: DashboardChatRequest): boolean {
    if (!this.handler) return false;

    const sessionId = message.sessionId || "dashboard:default";
    const parts = sessionId.split(":");
    const target = parts.length > 1 ? parts.slice(1).join(":") : "default";
    const event: InboundEvent = {
      sessionKey: sessionId,
      channel: "dashboard",
      target,
      author: "user",
      timestamp: Date.now(),
      content: message.content || "",
      attachments: message.attachments,
      raw: message,
      hasMention: true,
    };
    this.handler(event);
    return true;
  }
}
