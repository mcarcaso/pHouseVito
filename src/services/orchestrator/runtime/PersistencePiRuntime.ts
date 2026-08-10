/**
 * PERSISTENCE PI RUNTIME
 *
 * Decorator that stores all messages in the DB:
 * - User message (from options) at the start of run()
 * - Assistant messages as "thought" during the run
 * - Tool start/end rows during the run
 * - Promotes last thought → "assistant" on success
 * - Stores "*(interrupted)*" on abort
 */

import type { Context } from "../../../context/Context.js";
import { xMessageStore } from "../../../lib/x.js";
import type { MsgType } from "../../../stores/messages/MessageStore.js";
import { ProxyPiRuntime } from "./ProxyPiRuntime.js";
import type { PiRuntime, PiRuntimeCallbacks } from "./PiRuntime.js";

export interface PersistenceOptions {
  x: Context;
  sessionId: string;
  channel: string;
  target: string;
  /** Structured user content to store in DB (may differ from the prompt text) */
  userContent: unknown;
  userTimestamp: number;
  /** Author/sender name (username, tag, etc.) for user messages */
  author?: string;
}

export class PersistencePiRuntime extends ProxyPiRuntime {
  private readonly x: Context;
  private readonly sessionId: string;
  private readonly channel: string;
  private readonly target: string;
  private readonly userContent: unknown;
  private readonly userTimestamp: number;
  private readonly author: string | null;
  private assistantMessageIds: number[] = [];

  constructor(delegate: PiRuntime, opts: PersistenceOptions) {
    super(delegate);
    this.x = opts.x;
    this.sessionId = opts.sessionId;
    this.channel = opts.channel;
    this.target = opts.target;
    this.userContent = opts.userContent;
    this.userTimestamp = opts.userTimestamp;
    this.author = opts.author ?? null;
  }

  private insertMsg(
    type: MsgType,
    content: unknown,
    timestamp = Date.now(),
    author: string | null = null,
  ): number {
    return xMessageStore(this.x).create(this.x, {
      session_id: this.sessionId,
      channel: this.channel,
      channel_target: this.target,
      timestamp,
      type,
      content: JSON.stringify(content),
      archived: 0,
      author,
    }).id;
  }

  async run(
    systemPrompt: string,
    userMessage: string,
    callbacks: PiRuntimeCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    this.assistantMessageIds = [];

    // Store user message before delegating (with author)
    this.insertMsg("user", this.userContent, this.userTimestamp, this.author);

    const persistCallbacks: PiRuntimeCallbacks = {
      onInvocation: callbacks.onInvocation,
      onRawEvent: callbacks.onRawEvent,
      onNormalizedEvent: (event) => {
        if (event.kind === "assistant" && event.content) {
          const msgId = this.insertMsg("thought", event.content);
          this.assistantMessageIds.push(msgId);
        } else if (event.kind === "error") {
          this.insertMsg("assistant", `⚠️ ${event.message}`);
        }

        if (event.kind === "tool_start") {
          this.insertMsg("tool_start", {
            toolName: event.tool,
            toolCallId: event.callId,
            args: event.args,
          });
        } else if (event.kind === "tool_end") {
          this.insertMsg("tool_end", {
            toolName: event.tool,
            toolCallId: event.callId,
            result: event.result,
            isError: !event.success,
          });
        }

        callbacks.onNormalizedEvent(event);
      },
    };

    try {
      await this.delegate.run(systemPrompt, userMessage, persistCallbacks, signal);
    } catch (err) {
      if (signal?.aborted) {
        this.insertMsg("assistant", "*(interrupted)*");
      }
      throw err;
    }

    // Promote the last assistant message from "thought" → "assistant"
    if (this.assistantMessageIds.length > 0) {
      const lastId = this.assistantMessageIds[this.assistantMessageIds.length - 1];
      xMessageStore(this.x).update(this.x, {
        id: lastId,
        changes: { type: "assistant" },
      });
    }
  }
}

export function withPersistence(
  runtime: PiRuntime,
  opts: PersistenceOptions,
): PersistencePiRuntime {
  return new PersistencePiRuntime(runtime, opts);
}
