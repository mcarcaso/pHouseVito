/**
 * DirectChannel — A programmatic channel for API/internal use.
 * 
 * Unlike Discord/Telegram/Dashboard, this channel doesn't relay to a chat platform.
 * Instead, it captures the AI response and returns it directly to the caller.
 * 
 * This ensures API calls (Bland phone, webhooks, internal triggers) go through
 * the EXACT same pipeline as chat messages: full context, semantic search, 
 * decorators, persistence — no drift, no missing features.
 */

import type { Channel, InboundEvent, OutputHandler } from "../types.js";

interface PendingRequest {
  resolve: (response: string) => void;
  reject: (error: Error) => void;
  collectedMessages: string[];
}

export class DirectChannel implements Channel {
  name = "direct";
  
  capabilities = {
    typing: false,
    reactions: false,
    attachments: false,
    streaming: false,  // We collect, don't stream
  };

  private pendingRequests = new Map<string, PendingRequest>();
  private eventHandler: ((event: InboundEvent) => void) | null = null;

  async start(): Promise<void> {
    // No external connections to establish
  }

  async stop(): Promise<void> {
    // Reject any pending requests
    for (const [key, pending] of this.pendingRequests) {
      pending.reject(new Error("DirectChannel stopped"));
      this.pendingRequests.delete(key);
    }
  }

  async listen(onEvent: (event: InboundEvent) => void): Promise<() => void> {
    this.eventHandler = onEvent;
    return () => {
      this.eventHandler = null;
    };
  }

  /**
   * Send a question through the full AI pipeline and wait for the response.
   * This is the main entry point for API/programmatic use.
   */
  async ask(options: {
    question: string;
    session?: string;  // e.g., "api:bland-phone" — defaults to "api:default"
    author?: string;
    channelPrompt?: string;
  }): Promise<string> {
    if (!this.eventHandler) {
      throw new Error("DirectChannel not started — call start() and listen() first");
    }

    // Parse session into channel:target format
    const sessionParts = (options.session || "api:default").split(":");
    const channel = sessionParts[0] || "api";
    const target = sessionParts.slice(1).join(":") || "default";
    const sessionKey = `${channel}:${target}`;

    // Generate a unique request ID for this call
    const requestId = `${sessionKey}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    // Create promise that will be resolved when response is complete
    const responsePromise = new Promise<string>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        collectedMessages: [],
      });
    });

    // Default channel prompt for API/phone calls
    const defaultChannelPrompt = `## Channel: API
You are responding to a programmatic API request.
Keep responses concise and direct.
Do NOT use markdown formatting unless specifically requested.`;

    // Build the inbound event
    const event: InboundEvent = {
      sessionKey,
      channel,
      target,
      author: options.author || "api",
      timestamp: Date.now(),
      content: options.question,
      hasMention: true,  // Direct API calls always get a response
      raw: {
        synthetic: true,
        source: "direct-channel",
        requestId,
        // Per-request channel prompt — orchestrator checks event.raw.channelPrompt first
        channelPrompt: options.channelPrompt || defaultChannelPrompt,
      },
    };

    // Fire the event through the normal pipeline
    this.eventHandler(event);

    // Wait for response (with timeout)
    const timeout = 120000; // 2 minutes max
    const timeoutPromise = new Promise<string>((_, reject) => {
      setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`DirectChannel request timed out after ${timeout}ms`));
      }, timeout);
    });

    return Promise.race([responsePromise, timeoutPromise]);
  }

  getSessionKey(event: InboundEvent): string {
    return event.sessionKey;
  }

  createHandler(event: InboundEvent): OutputHandler {
    const requestId = event.raw?.requestId as string;

    return {
      relay: async (msg: string) => {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          pending.collectedMessages.push(msg);
        }
      },

      relayEvent: async () => {
        // No UI to send tool events to
      },

      startTyping: async () => {
        // No typing indicator for API
      },

      stopTyping: async () => {
        // No typing indicator for API
      },

      endMessage: async () => {
        // Called when a complete assistant message ends
        // For final mode, this is where we resolve the promise
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          // Get the last message (final response) or empty string if none
          const response = pending.collectedMessages.length > 0
            ? pending.collectedMessages[pending.collectedMessages.length - 1]
            : "";
          pending.resolve(response);
          this.pendingRequests.delete(requestId);
        }
      },
    };
  }
}

// Singleton instance for the orchestrator to use
let directChannelInstance: DirectChannel | null = null;

export function getDirectChannel(): DirectChannel {
  if (!directChannelInstance) {
    directChannelInstance = new DirectChannel();
  }
  return directChannelInstance;
}
