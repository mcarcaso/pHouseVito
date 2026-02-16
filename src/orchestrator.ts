
import {
  type AgentSession,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import { PiHarness, ClaudeCodeHarness, withTracing, type Harness, type TracingOptions } from "./harnesses/index.js";
import type { Queries } from "./db/queries.js";
import { assembleContext, formatContextForPrompt } from "./memory/context.js";
import { shouldCompact, runCompaction, runSessionCompaction } from "./memory/compaction.js";
import { SessionManager } from "./sessions/manager.js";
import { discoverSkills, formatSkillsForPrompt } from "./skills/discovery.js";
import { CronScheduler } from "./cron/scheduler.js";

import type {
  VitoConfig,
  InboundEvent,
  Channel,
  OutboundMessage,
  StreamMode,
  SessionConfig,
  SkillMeta,
  CronJobConfig,
} from "./types.js";
import { resolve, join } from "path";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { randomBytes } from "crypto";



export class Orchestrator {
  private sessionManager: SessionManager;
  private channels = new Map<string, Channel>();
  private cronScheduler: CronScheduler;
  private soul: string;
  private skillsDir: string;
  /** Per-session message queues and processing locks */
  private sessionQueues = new Map<string, Array<{ event: InboundEvent; channel: Channel | null }>>();
  private sessionProcessing = new Set<string>();
  /** Track active requests so they can be aborted on interrupt */
  private activeRequests = new Map<string, { abort: AbortController; aborted: boolean }>();


  constructor(
    private queries: Queries,
    private config: VitoConfig,
    soul: string,
    skillsDir: string
  ) {
    this.sessionManager = new SessionManager(queries);
    this.soul = soul;
    this.skillsDir = skillsDir;
    
    // Initialize cron scheduler with callback to remove one-time jobs from config
    this.cronScheduler = new CronScheduler(
      async (event, channelName) => {
        const channel = channelName ? this.channels.get(channelName) || null : null;
        await this.handleInbound(event, channel);
      },
      async (jobName: string) => {
        await this.removeJobFromConfig(jobName);
      }
    );

    const skills = this.getSkills();
    if (skills.length > 0) {
      console.log(
        `Found ${skills.length} skill(s): ${skills.map((s) => s.name).join(", ")}`
      );
    }
  }

  /** Register a channel with the orchestrator */
  registerChannel(channel: Channel): void {
    this.channels.set(channel.name, channel);
  }

  /** Read skills from disk on demand — never cached */
  getSkills(): SkillMeta[] {
    return discoverSkills(this.skillsDir);
  }

  /** Get cron scheduler for dashboard API */
  getCronScheduler() {
    return this.cronScheduler;
  }

  /** Reload cron jobs from updated config (hot-reload) */
  reloadCronJobs(jobs: CronJobConfig[]): void {
    this.cronScheduler.reload(jobs);
  }

  /** Hot-reload the full config (model, memory, etc.) */
  reloadConfig(config: VitoConfig): void {
    this.config = config;
    const activeModel = config.harnesses?.["pi-coding-agent"]?.model || config.model;
    const modelStr = activeModel ? `${activeModel.provider}/${activeModel.name}` : "default";
    console.log(`[Orchestrator] Config reloaded — model: ${modelStr}`);
  }

  /** Remove a one-time job from the config file after it completes */
  private async removeJobFromConfig(jobName: string): Promise<void> {
    console.log(`[Config] removeJobFromConfig called for: ${jobName}`);
    try {
      const configPath = resolve(process.cwd(), "user/vito.config.json");
      console.log(`[Config] Config path resolved to: ${configPath}`);
      const fs = await import("fs/promises");
      const configText = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(configText);
      
      // Filter out the completed job
      const originalLength = config.cron.jobs.length;
      console.log(`[Config] Current jobs count: ${originalLength}`);
      config.cron.jobs = config.cron.jobs.filter((job: CronJobConfig) => job.name !== jobName);
      console.log(`[Config] Jobs after filter: ${config.cron.jobs.length}`);
      
      if (config.cron.jobs.length < originalLength) {
        await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
        console.log(`[Config] ✅ Removed one-time job from config: ${jobName}`);
      } else {
        console.log(`[Config] ⚠️ Job ${jobName} not found in config`);
      }
    } catch (err) {
      console.error(`[Config] ❌ Failed to remove job ${jobName} from config:`, err);
    }
  }

  /** Download attachments that have URL but no local path */
  private async downloadAttachments(event: InboundEvent): Promise<void> {
    if (!event.attachments?.length) return;
    
    const imagesDir = resolve(process.cwd(), "user/images");
    mkdirSync(imagesDir, { recursive: true });
    
    for (const attachment of event.attachments) {
      // Skip if already has a local path
      if (attachment.path) continue;
      // Skip if no URL to download from
      if (!attachment.url) continue;
      
      try {
        console.log(`[Orchestrator] Downloading attachment from: ${attachment.url.substring(0, 80)}...`);
        
        const response = await fetch(attachment.url);
        if (!response.ok) {
          console.error(`[Orchestrator] Failed to download attachment: ${response.status}`);
          continue;
        }
        
        const buffer = Buffer.from(await response.arrayBuffer());
        
        // Generate unique filename
        const ext = this.getExtensionForMime(attachment.mimeType || "application/octet-stream");
        const filename = `${Date.now()}_${randomBytes(4).toString("hex")}${ext}`;
        const localPath = join(imagesDir, filename);
        
        writeFileSync(localPath, buffer);
        attachment.path = localPath;
        attachment.buffer = buffer; // Keep buffer for passing to harness if needed
        
        console.log(`[Orchestrator] ✓ Downloaded attachment to: ${localPath}`);
      } catch (err) {
        console.error(`[Orchestrator] Error downloading attachment:`, err);
      }
    }
  }
  
  /** Get file extension from MIME type */
  private getExtensionForMime(mimeType: string): string {
    const map: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "image/svg+xml": ".svg",
      "audio/mpeg": ".mp3",
      "audio/ogg": ".ogg",
      "audio/wav": ".wav",
      "video/mp4": ".mp4",
      "video/webm": ".webm",
      "application/pdf": ".pdf",
      "text/plain": ".txt",
    };
    return map[mimeType] || "";
  }

  /** Start all enabled channels and begin listening */
  async start(): Promise<void> {
    for (const [name, channel] of this.channels) {
      const channelConfig = this.config.channels[name];
      if (!channelConfig?.enabled) continue;

      try {
        await channel.start();
        await channel.listen((event) => this.handleInbound(event, channel));
        console.log(`Channel started: ${name}`);
      } catch (err) {
        console.error(`Channel failed to start: ${name}`, err);
      }
    }
    
    // Start cron scheduler
    this.cronScheduler.start(this.config.cron.jobs);
  }

  /** Stop all channels */
  async stop(): Promise<void> {
    this.cronScheduler.stop();
    for (const [, channel] of this.channels) {
      await channel.stop();
    }
  }

  /** Handle an inbound message from any channel */
  private async handleInbound(
    event: InboundEvent,
    channel: Channel | null
  ): Promise<void> {
    const sessionKey = `${event.channel}:${event.target}`;
    console.log(`[handleInbound] ⚡ Received event from ${sessionKey}`);
    
    // If there's an active request for this key, abort it (interrupt)
    const active = this.activeRequests.get(sessionKey);
    if (active && !active.aborted) {
      console.log(`[handleInbound] ⛔ Aborting active request for ${sessionKey}`);
      active.aborted = true;
      active.abort.abort();
    }

    // Get or create the per-session queue
    if (!this.sessionQueues.has(sessionKey)) {
      this.sessionQueues.set(sessionKey, []);
    }
    const queue = this.sessionQueues.get(sessionKey)!;

    // Clear any previously queued messages for this session (user changed their mind)
    if (queue.length > 0) {
      console.log(`[handleInbound] Cleared ${queue.length} queued messages for ${sessionKey}`);
      queue.length = 0;
    }

    // Queue message
    queue.push({ event, channel });
    const isAlreadyProcessing = this.sessionProcessing.has(sessionKey);
    console.log(`[handleInbound] Message queued for ${sessionKey}. Queue length: ${queue.length}, processing: ${isAlreadyProcessing}`);
    if (isAlreadyProcessing) return;

    // Process this session's queue (runs concurrently with other sessions)
    await this.processSessionQueue(sessionKey);
  }

  private async processSessionQueue(sessionKey: string): Promise<void> {
    this.sessionProcessing.add(sessionKey);
    const queue = this.sessionQueues.get(sessionKey);

    while (queue && queue.length > 0) {
      const { event, channel } = queue.shift()!;
      try {
        await this.processMessage(event, channel);
      } catch (err) {
        console.error(`Error processing message for ${sessionKey}:`, err);
        if (channel) {
          const handler = channel.createHandler(event);
          await handler.relay(
            "Sorry, something went wrong processing that message."
          );
        }
      }
    }

    this.sessionProcessing.delete(sessionKey);
    // Clean up empty queues
    if (queue && queue.length === 0) {
      this.sessionQueues.delete(sessionKey);
    }
  }

  private async processMessage(
    event: InboundEvent,
    channel: Channel | null
  ): Promise<void> {
    // Check for /new command (only for non-cron messages)
    if (channel && event.content?.trim() === '/new') {
      await this.handleNewCommand(event, channel);
      return;
    }

    // 1. Resolve/create Vito session
    const vitoSession = this.sessionManager.resolveSession(
      event.channel,
      event.target
    );

    // 1.5. Download any remote attachments (e.g., from Telegram)
    await this.downloadAttachments(event);

    // 2. Store the user message in our DB (paths only, no base64)
    const storedContent = event.attachments?.length
      ? JSON.stringify({
          text: event.content,
          attachments: event.attachments.map((a) => ({
            type: a.type,
            path: a.path,
            filename: a.filename,
            mimeType: a.mimeType,
          })),
        })
      : JSON.stringify(event.content);

    this.queries.insertMessage({
      session_id: vitoSession.id,
      channel: event.channel,
      channel_target: event.target,
      timestamp: event.timestamp,
      type: "user",
      content: storedContent,
      compacted: 0,
      archived: 0,
    });

    // 3. Build fresh context
    const ctx = await assembleContext(
      this.queries,
      vitoSession.id,
      this.config
    );
    const contextPrompt = formatContextForPrompt(ctx);
    const skillsPrompt = formatSkillsForPrompt(this.getSkills());

    // 4. Set up output handler and message tracking
    const handler = channel ? channel.createHandler(event) : null;
    const sessionConfig: SessionConfig = JSON.parse(vitoSession.config || "{}");

    // Create harness for this request (respects session config overrides)
    // Wrap with tracing to log all events
    const innerHarness = this.getHarness(sessionConfig);
    const harness = withTracing(innerHarness, {
      session_id: vitoSession.id,
      channel: event.channel,
      target: event.target,
      model: this.getModelString(sessionConfig),
    });

    // Build system prompt with harness-specific custom instructions
    const systemPrompt = this.buildSystemPrompt(
      contextPrompt,
      skillsPrompt,
      channel?.getCustomPrompt?.() || "",
      innerHarness.getCustomInstructions?.() || ""
    );
    
    const streamMode = this.getStreamMode(event.channel, sessionConfig);
    console.log(`[Orchestrator] Stream mode for ${event.channel}: ${streamMode}`);

    // 5. Collect response using harness
    const completedMessages: string[] = [];
    const assistantMessageIds: number[] = [];
    let currentMessageText = "";
    let rawStreamedContent = false; // Track if raw text_delta events streamed content for this message

    // 6. Set up abort controller for this request
    const sessionKey = `${event.channel}:${event.target}`;
    const abortController = new AbortController();
    const activeEntry = { abort: abortController, aborted: false };
    this.activeRequests.set(sessionKey, activeEntry);

    // Start typing indicator
    await handler?.startTyping?.();

    let llmError: string | null = null;
    const execStart = Date.now();

    // 7. Build user message (include attachment file paths if any)
    let promptText = event.content || "";
    if (event.attachments?.length) {
      const refs = event.attachments
        .map((a) => {
          const ref = a.path || a.filename || "(attachment)";
          return `[Attached ${a.type}: ${ref}]`;
        })
        .join("\n");
      promptText = promptText ? `${promptText}\n\n${refs}` : refs;
    }

    console.log(`[Orchestrator] Sending prompt to LLM (${promptText.length} chars)...`);

    try {
      await harness.run(
        systemPrompt,
        promptText,
        {
          onInvocation: () => {
            // Tracing is handled by TracingHarness wrapper
          },
          onRawEvent: (agentEvent) => {
            // Tracing is handled by TracingHarness wrapper
            // Handle streaming text
            const e = agentEvent as AgentSessionEvent;
            if (e.type === "message_start") {
              currentMessageText = "";
              rawStreamedContent = false;
            } else if (e.type === "message_update") {
              const msgEvent = e.assistantMessageEvent;
              if (msgEvent.type === "text_delta") {
                currentMessageText += msgEvent.delta;
                rawStreamedContent = true;
                if (streamMode === "stream" && handler) {
                  handler.relay(msgEvent.delta).catch(() => {});
                }
              }
            } else if (e.type === "message_end") {
              // Reset streaming text buffer — actual message saving happens in onNormalizedEvent
              currentMessageText = "";
            }
          },
          onNormalizedEvent: (normEvent) => {
            // Handle normalized assistant messages — single source of truth for DB inserts
            if (normEvent.kind === "assistant" && normEvent.content) {
              completedMessages.push(normEvent.content);
              
              const msgId = this.queries.insertMessage({
                session_id: vitoSession.id,
                channel: event.channel,
                channel_target: event.target,
                timestamp: Date.now(),
                type: "thought",
                content: JSON.stringify(normEvent.content),
                compacted: 0,
                archived: 0,
              });
              assistantMessageIds.push(msgId);
              
              // For streaming mode, relay content and signal message boundary
              // If raw text_delta events already streamed the content, buffer will flush what's there.
              // If not (e.g. claude-code harness doesn't emit text_delta), relay the full content now.
              if (streamMode === "stream" && handler) {
                if (!rawStreamedContent) {
                  // Harness didn't emit raw text_delta events (e.g. claude-code) — relay full content now
                  handler.relay(normEvent.content).catch((err: any) => {
                    console.error(`[Orchestrator] relay failed during stream: ${err.message}`);
                  });
                }
                rawStreamedContent = false; // Reset for next message
                handler.endMessage?.()?.catch((err: any) => {
                  console.error(`[Orchestrator] endMessage failed during stream: ${err.message}`);
                });
                handler.startTyping?.()?.catch(() => {});
              }
            }
            
            // Handle normalized tool events (cleaner interface)
            if (normEvent.kind === "tool_start") {
              this.queries.insertMessage({
                session_id: vitoSession.id,
                channel: event.channel,
                channel_target: event.target,
                timestamp: Date.now(),
                type: "tool_start",
                content: JSON.stringify({
                  toolName: normEvent.tool,
                  toolCallId: normEvent.callId,
                  args: normEvent.args,
                }),
                compacted: 0,
                archived: 0,
              });
              handler?.relayEvent?.({
                kind: "tool_start",
                toolName: normEvent.tool,
                toolCallId: normEvent.callId,
                args: normEvent.args,
              })?.catch(() => {});
            } else if (normEvent.kind === "tool_end") {
              this.queries.insertMessage({
                session_id: vitoSession.id,
                channel: event.channel,
                channel_target: event.target,
                timestamp: Date.now(),
                type: "tool_end",
                content: JSON.stringify({
                  toolName: normEvent.tool,
                  toolCallId: normEvent.callId,
                  result: normEvent.result,
                  isError: !normEvent.success,
                }),
                compacted: 0,
                archived: 0,
              });
              handler?.relayEvent?.({
                kind: "tool_end",
                toolName: normEvent.tool,
                toolCallId: normEvent.callId,
                result: normEvent.result,
                isError: !normEvent.success,
              })?.catch(() => {});
            }
          },
        },
        abortController.signal
      );

      console.log(`[Orchestrator] LLM response complete (${completedMessages.length} messages)`);

      // Mark the last assistant message as 'assistant' (the actual response, not a thought)
      if (assistantMessageIds.length > 0) {
        const lastMsgId = assistantMessageIds[assistantMessageIds.length - 1];
        this.queries.updateMessageType(lastMsgId, "assistant");
      }

      llmError = null;
    } catch (err) {
      // Handle abort gracefully (user interrupted)
      if (activeEntry.aborted) {
        console.log(`[Orchestrator] ⛔ Session ${sessionKey} aborted by user`);

        // Store an assistant message noting the interruption
        this.queries.insertMessage({
          session_id: vitoSession.id,
          channel: event.channel,
          channel_target: event.target,
          timestamp: Date.now(),
          type: "assistant",
          content: JSON.stringify("*(interrupted)*"),
          compacted: 0,
          archived: 0,
        });

        if (handler) {
          if (streamMode === "stream") {
            await handler.endMessage?.();
          }
          await handler.relay("*(interrupted)*");
          await handler.endMessage?.();
        }
        llmError = "aborted";
      } else {
        // Handle timeout or other errors
        llmError = err instanceof Error ? err.message : String(err);
        console.error(`[Orchestrator] Error during LLM call: ${llmError}`);

        // Send error message to user
        if (handler) {
          await handler.relay(`⚠️ ${llmError}`);
          await handler.endMessage?.();
        }
      }
    } finally {
      this.activeRequests.delete(sessionKey);
      await handler?.stopTyping?.();
    }

    // If there was an error, skip normal response handling
    if (llmError) {
      return;
    }

    // 8. Relay responses for non-stream modes

    if (handler) {
      if (streamMode === "bundled") {
        // Send all messages combined as one blob after the agent loop finishes
        const combined = completedMessages.join("\n\n");
        await handler.relay(combined);
        await handler.endMessage?.();

      } else if (streamMode === "final" && completedMessages.length > 0) {
        // Send only the final message
        const last = completedMessages[completedMessages.length - 1];
        await handler.relay(last);
        await handler.endMessage?.();

      }
    }

    // 9. Assistant messages already inserted in message_end event handler above

    // 10. Signal the channel that the response is complete (for re-prompting)
    if (channel) {
      this.notifyResponseComplete(channel);

    }

    // 11. Check if compaction is needed (run in background)
    if (shouldCompact(this.queries, this.config)) {
      console.log("\nCompaction threshold reached, running memory compaction...");
      runCompaction(this.queries, this.config, (prompt) => this.runCompactionPrompt(prompt))
        .then(() => {
          console.log("Compaction complete.");
        })
        .catch((err) => {
          console.error("Compaction failed:", err);
        });
    }
  }

  private async handleNewCommand(
    event: InboundEvent,
    channel: Channel
  ): Promise<void> {
    const vitoSession = this.sessionManager.resolveSession(
      event.channel,
      event.target
    );

    const handler = channel.createHandler(event);

    // Check if there are any non-archived messages to process
    const recentMessages = this.queries.getRecentMessages(vitoSession.id, 1);
    if (recentMessages.length === 0) {
      await handler.relay(
        "✅ Already starting fresh! No messages to archive."
      );
      return;
    }

    await handler.startTyping?.();

    try {
      // Step 1: Compact any un-compacted messages in this session
      const uncompacted = this.queries.getUncompactedMessagesForSession(vitoSession.id);
      
      if (uncompacted.length > 0) {
        console.log(`\n[/new] Compacting ${uncompacted.length} un-compacted messages for session ${vitoSession.id}...`);
        
        await runSessionCompaction(this.queries, vitoSession.id, (prompt) => this.runCompactionPrompt(prompt));

        console.log(`[/new] Compaction complete for session ${vitoSession.id}`);
      }

      // Step 2: Archive ALL messages in this session (compacted and newly-compacted)
      this.queries.markSessionArchived(vitoSession.id);
      console.log(`[/new] All messages archived for session ${vitoSession.id}`);

      await handler.stopTyping?.();
      await handler.relay(
        `✅ **Fresh start!**\n\n${uncompacted.length > 0 ? `Compacted ${uncompacted.length} message(s) into long-term memory. ` : ""}All messages archived. Same session, clean slate.\n\nReady for a new conversation! 🚀`
      );
    } catch (err) {
      await handler.stopTyping?.();
      console.error("[/new] Compaction/archive failed:", err);
      await handler.relay(
        "❌ Sorry, something went wrong. Please try again."
      );
    }
  }

  private notifyResponseComplete(channel: Channel): void {
    // Hook for channels that need post-response actions (e.g. re-prompting)
    if ("reprompt" in channel && typeof (channel as any).reprompt === "function") {
      (channel as any).reprompt();
    }
  }

  /**
   * Run a compaction prompt through the harness (no tools, simple summarization)
   */
  private async runCompactionPrompt(prompt: string): Promise<string> {
    // Create a minimal harness for compaction (no skills needed)
    const piConfig = this.getDefaultPiConfig();
    const compactionHarness = new PiHarness({
      model: piConfig.model,
      thinkingLevel: "off",
      // No skillsDir — compaction doesn't need tools
    });

    const systemPrompt = `You are a conversation summarizer. Condense the provided messages while preserving:
- Key facts and decisions
- Important context and user preferences
- Any commitments or action items

Be concise but comprehensive.`;

    let response = "";
    await compactionHarness.run(
      systemPrompt,
      prompt,
      {
        onInvocation: () => {}, // Not tracing compaction
        onRawEvent: () => {},
        onNormalizedEvent: (event) => {
          if (event.kind === "assistant") {
            response = event.content;
          }
        },
      }
    );

    return response;
  }

  private buildSystemPrompt(
    contextPrompt: string,
    skillsPrompt: string,
    channelPrompt: string,
    harnessInstructions: string = ""
  ): string {
    const parts: string[] = [];

    // Full date with day-of-week at the very top — every harness, every channel
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "America/Toronto",
    });
    const timeStr = now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Toronto",
    });
    parts.push(`Today is ${dateStr}. Current time: ${timeStr} ET.`);

    if (this.soul) {
      parts.push(`<personality>\n${this.soul}\n</personality>`);
    }

    // Point to SYSTEM.md instead of injecting it — keep prompt lean
    parts.push(`<system>
For system architecture, file structure, restart rules, bash guidelines, and operational knowledge, read SYSTEM.md using the Read tool. Only pull it when you need system-level context.

You can query the SQLite database (user/vito.db) for more message history if needed. Read SYSTEM.md for schema details.

To send/share a file or image inline, output MEDIA:/path/to/file on its own line. The channel will deliver it as an attachment. Don't paste file contents when the user asks you to "send" a file — use MEDIA: instead.

NEVER restart yourself. You don't know what long-running jobs might be in progress. When changes need a restart, say "changes are ready, restart when you're clear" and let the boss decide when.

Available commands: /new (compact + archive session)

## Investigation First

When instructions are vague or incomplete, investigate before asking:
- Check user memories in user/memories/ — they contain context, preferences, and prior intel
- Check existing files and configs
- Query the message history if needed
- Only ask clarifying questions if you've genuinely exhausted available context

Treat unknowns as puzzles to solve, not gaps to fill with questions.
</system>`);

    if (skillsPrompt) {
      parts.push(`<skills>\n${skillsPrompt}\n</skills>`);
    }

    if (channelPrompt) {
      parts.push(`<channel>\n${channelPrompt}\n</channel>`);
    }

    // Inject harness-specific instructions if they exist (before memory)
    if (harnessInstructions) {
      parts.push(`<custom-instructions>\n${harnessInstructions}\n</custom-instructions>`);
    }

    if (contextPrompt) {
      parts.push(`<memory>\n${contextPrompt}\n</memory>`);
    }

    return parts.join("\n\n");
  }

  /** Get a human-readable model string from session config */
  private getModelString(sessionConfig?: SessionConfig): string {
    const harnessName = sessionConfig?.harness || this.config.harnesses?.default || "pi-coding-agent";
    if (harnessName === "claude-code") {
      const globalCCConfig = this.config.harnesses?.["claude-code"] as Record<string, any> | undefined;
      return sessionConfig?.["claude-code"]?.model || globalCCConfig?.model || "sonnet";
    }
    const sessionOverrides = sessionConfig?.["pi-coding-agent"];
    const legacyModel = sessionConfig?.model;
    const model = legacyModel || sessionOverrides?.model || this.getDefaultPiConfig().model;
    return `${model.provider}/${model.name}`;
  }

  private getStreamMode(channelName: string, sessionConfig?: SessionConfig): StreamMode {
    return sessionConfig?.streamMode || this.config.channels[channelName]?.streamMode || "final";
  }

  /**
   * Get the default harness config (with backward compat for old config.model)
   */
  private getDefaultPiConfig() {
    // New config structure takes priority
    if (this.config.harnesses?.["pi-coding-agent"]) {
      return this.config.harnesses["pi-coding-agent"];
    }
    // Fall back to deprecated config.model
    if (this.config.model) {
      return {
        model: this.config.model,
        thinkingLevel: "off" as const,
      };
    }
    // Ultimate fallback
    return {
      model: { provider: "anthropic", name: "claude-sonnet-4-20250514" },
      thinkingLevel: "off" as const,
    };
  }

  /**
   * Create a harness for the given session config.
   * Session config can override which harness to use and harness-specific settings.
   */
  private getHarness(sessionConfig?: SessionConfig): Harness {
    // Determine which harness to use
    const harnessName = sessionConfig?.harness || this.config.harnesses?.default || "pi-coding-agent";
    
    if (harnessName === "claude-code") {
      // Claude Code harness - merge global config with session overrides
      const globalConfig = this.config.harnesses?.["claude-code"] || {};
      const sessionOverrides = sessionConfig?.["claude-code"] || {};
      
      // Session overrides take precedence over global config
      const mergedConfig = { ...globalConfig, ...sessionOverrides };
      
      const harness = new ClaudeCodeHarness({
        model: mergedConfig.model || "sonnet",
        cwd: mergedConfig.cwd || process.cwd(),
        permissionMode: mergedConfig.permissionMode || "bypassPermissions",
        allowedTools: mergedConfig.allowedTools,
      });

      console.log(`[Orchestrator] 🎭 Created harness: ${harness.getName()} (model: ${mergedConfig.model || "sonnet"})`);
      return harness;
    }
    
    // Default: pi-coding-agent
    if (harnessName !== "pi-coding-agent") {
      console.warn(`[Orchestrator] Unknown harness "${harnessName}", falling back to pi-coding-agent`);
    }

    // Get base config for pi-coding-agent
    const baseConfig = this.getDefaultPiConfig();
    
    // Apply session-level overrides (new structure)
    const sessionOverrides = sessionConfig?.["pi-coding-agent"];
    
    // Also support deprecated sessionConfig.model for backward compat
    const legacyModelOverride = sessionConfig?.model;
    
    // Merge: base < session overrides < legacy model override
    const model = legacyModelOverride || sessionOverrides?.model || baseConfig.model;
    const thinkingLevel = sessionOverrides?.thinkingLevel || baseConfig.thinkingLevel || "off";
    
    const harness = new PiHarness({
      model,
      thinkingLevel,
      skillsDir: this.skillsDir,
    });

    console.log(`[Orchestrator] 🎭 Created harness: ${harness.getName()} (${model.provider}/${model.name})`);
    return harness;
  }
}


