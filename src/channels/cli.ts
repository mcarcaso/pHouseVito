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
    let isFirstChunk = true;

    return {
      relay: async (msg) => {
        if (msg.text) {
          if (isFirstChunk) {
            process.stdout.write("assistant: ");
            isFirstChunk = false;
          }
          process.stdout.write(msg.text);
        }
        if (msg.attachments) {
          for (const att of msg.attachments) {
            console.log(`\n[Attachment: ${att.path || att.url || att.filename}]`);
          }
        }
      },
    };
  }

  getSessionKey(event: InboundEvent): string {
    return "cli:default";
  }
}
