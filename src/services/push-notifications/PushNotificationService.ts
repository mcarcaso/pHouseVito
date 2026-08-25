import type { Context } from "../../context/Context.js";

export interface FinalAssistantMessage {
  messageId: number;
  sessionId: string;
  channel: string;
  content: string;
}

export interface PushNotificationService {
  start(x: Context): void;
  registerDevice(
    x: Context,
    input: {
      deviceId: string;
      token: string;
      platform: string;
      appId?: string;
      showPreview?: boolean;
    },
  ): Promise<void>;
  enqueueForMessage(x: Context, message: FinalAssistantMessage): void;
  notifyServerStarted(x: Context): Promise<void>;
  deliverPending(x: Context): Promise<void>;
}
