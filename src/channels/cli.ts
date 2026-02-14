import * as readline from "readline";
import type { Channel, InboundEvent, OutputHandler } from "../types.js";

export class CLIChannel implements Channel {
  name = "cli";
  capabilities = {
    typing: false,
    reactions: false,
    attachments: false,
    streaming: true,
  };

  private rl: readline.Interface | null = null;
  private promptUser: (() => void) | null = null;

  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async stop(): Promise<void> {
    this.rl?.close();
    this.rl = null;
  }

  async listen(
    onEvent: (event: InboundEvent) => void
  ): Promise<() => void> {
    const prompt = () => {
      this.rl?.question("you: ", async (input) => {
        const trimmed = input.trim();
        if (!trimmed) {
          prompt();
          return;
        }

        if (trimmed === "/quit" || trimmed === "/exit") {
          console.log("Goodbye!");
          process.exit(0);
        }

        const event: InboundEvent = {
          sessionKey: "cli:default",
          channel: "cli",
          target: "default",
          author: "user",
          timestamp: Date.now(),
          content: trimmed,
          raw: { input: trimmed },
        };

        onEvent(event);
      });
    };

    this.promptUser = prompt;

    return () => {
      this.promptUser = null;
    };
  }

  /** Called by orchestrator after response is complete to re-prompt */
  reprompt(): void {
    if (this.promptUser) {
      // Small delay so the response text finishes writing
      setTimeout(() => {
        process.stdout.write("\n\n");
        this.promptUser?.();
      }, 100);
    }
  }

  /** Start the initial prompt (call after startup messages are done) */
  startPrompting(): void {
    this.promptUser?.();
  }

  createHandler(event: InboundEvent): OutputHandler {
    let buffer = "";

    return {
      relay: async (msg) => {
        console.log(`[CLI] relay() called with text length: ${msg?.length || 0}`);
        // In "none" mode, relay is called once with full text AFTER stopTyping
        // In "stream" mode, relay is called many times with deltas BEFORE stopTyping
        buffer += msg;
        
        console.log(`[CLI] Buffer length after relay: ${buffer.length}`);
        
        // If buffer looks complete (no more chunks coming), flush immediately
        // This handles "none" mode where relay is called after stopTyping
        if (buffer.length > 0) {
          console.log(`[CLI] Flushing immediately from relay()`);
          this.flushOutput(buffer);
          buffer = "";
        }
      },
      
      stopTyping: async () => {
        console.log(`[CLI] stopTyping() called, buffer length: ${buffer.length}`);
        // Flush any remaining buffer (handles "stream" mode)
        if (buffer.length > 0) {
          console.log(`[CLI] Flushing from stopTyping()`);
          this.flushOutput(buffer);
          buffer = "";
        }
      },
    };
  }

  private flushOutput(text: string): void {
    console.log(`[CLI] flushOutput() called with text length: ${text.length}`);
    process.stdout.write("\nassistant: ");
    process.stdout.write(text);
  }

  getSessionKey(event: InboundEvent): string {
    return "cli:default";
  }
}
