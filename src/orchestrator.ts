import { getModel } from "@mariozechner/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager as PiSessionManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import type { Queries } from "./db/queries.js";
import { assembleContext, formatContextForPrompt } from "./memory/context.js";
import { shouldCompact, runCompaction } from "./memory/compaction.js";
import { SessionManager } from "./sessions/manager.js";
import { discoverSkills, formatSkillsForPrompt } from "./skills/discovery.js";
import { loadSkillTools, convertToolsForPi } from "./skills/loader.js";
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
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "fs";



export class Orchestrator {
  private sessionManager: SessionManager;
  private channels = new Map<string, Channel>();
  private cronScheduler: CronScheduler;
  private soul: string;
  private skillsDir: string;
  private isProcessing = false;
  private messageQueue: Array<{
    event: InboundEvent;
    channel: Channel | null;
  }> = [];
  /** Track active Pi sessions so we can abort them on interrupt */
  private activeSessions = new Map<string, { piSession: AgentSession; aborted: boolean }>();

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

  /** Start all enabled channels and begin listening */
  async start(): Promise<void> {
    for (const [name, channel] of this.channels) {
      const channelConfig = this.config.channels[name];
      if (!channelConfig?.enabled) continue;

      await channel.start();
      await channel.listen((event) => this.handleInbound(event, channel));
      console.log(`Channel started: ${name}`);
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
    this.logToFile(`[handleInbound] Channel: ${event.channel}, Target: ${event.target}, Content: ${event.content ? event.content.substring(0, 50) + '...' : '(empty)'}`);
    
    // If there's an active session for this key, abort it
    const active = this.activeSessions.get(sessionKey);
    if (active && !active.aborted) {
      console.log(`[handleInbound] ⛔ Aborting active session for ${sessionKey}`);
      this.logToFile(`[handleInbound] Aborting active Pi session for ${sessionKey}`);
      active.aborted = true;
      try {
        await active.piSession.abort();
      } catch (err) {
        console.error(`[handleInbound] Error aborting session: ${err}`);
      }
    }

    // Remove any queued messages for the same session (user changed their mind)
    const before = this.messageQueue.length;
    this.messageQueue = this.messageQueue.filter(
      (m) => `${m.event.channel}:${m.event.target}` !== sessionKey
    );
    if (this.messageQueue.length < before) {
      console.log(`[handleInbound] Cleared ${before - this.messageQueue.length} queued messages for ${sessionKey}`);
    }

    // Queue message
    this.messageQueue.push({ event, channel });
    console.log(`[handleInbound] Message queued. Queue length: ${this.messageQueue.length}, isProcessing: ${this.isProcessing}`);
    if (this.isProcessing) return;
    await this.processQueue();
  }

  private async processQueue(): Promise<void> {
    this.isProcessing = true;
    while (this.messageQueue.length > 0) {
      const { event, channel } = this.messageQueue.shift()!;
      try {
        await this.processMessage(event, channel);
      } catch (err) {
        console.error("Error processing message:", err);
        if (channel) {
          const handler = channel.createHandler(event);
          await handler.relay(
            "Sorry, something went wrong processing that message."
          );
        }
      }
    }
    this.isProcessing = false;
  }

  private async processMessage(
    event: InboundEvent,
    channel: Channel | null
  ): Promise<void> {
    this.logToFile(`[processMessage] START - Channel: ${event.channel}, Target: ${event.target}`);
    this.logToFile(`[processMessage] Content: ${event.content ? event.content.substring(0, 100) + '...' : '(empty)'}`);
    
    // Check for /new command (only for non-cron messages)
    if (channel && event.content?.trim() === '/new') {
      this.logToFile(`[processMessage] Handling /new command`);
      await this.handleNewCommand(event, channel);
      return;
    }

    // Check for /reload command (only for non-cron messages)
    if (channel && event.content?.trim() === '/reload') {
      this.logToFile(`[processMessage] Handling /reload command`);
      await this.handleReloadCommand(event, channel);
      return;
    }

    // 1. Resolve/create Vito session
    this.logToFile(`[processMessage] Resolving session...`);
    const vitoSession = this.sessionManager.resolveSession(
      event.channel,
      event.target
    );
    this.logToFile(`[processMessage] Session resolved: ${vitoSession.id}`);

    // 2. Store the user message in our DB (paths only, no base64)
    this.logToFile(`[processMessage] Storing user message in DB...`);
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
      role: "user",
      content: storedContent,
      compacted: 0,
    });
    this.logToFile(`[processMessage] User message stored`);

    // 3. Build fresh context
    this.logToFile(`[processMessage] Building context...`);
    const ctx = await assembleContext(
      this.queries,
      vitoSession.id,
      this.config
    );
    this.logToFile(`[processMessage] Context assembled`);
    
    const contextPrompt = formatContextForPrompt(ctx);
    const skillsPrompt = formatSkillsForPrompt(this.getSkills());
    const systemPrompt = this.buildSystemPrompt(
      contextPrompt,
      skillsPrompt,
      channel?.getCustomPrompt?.() || ""
    );
    this.logToFile(`[processMessage] System prompt built - length: ${systemPrompt.length} chars`);

    // 4. Set up output handler and message tracking
    const handler = channel ? channel.createHandler(event) : null;
    const sessionConfig: SessionConfig = JSON.parse(vitoSession.config || "{}");
    const streamMode = this.getStreamMode(event.channel, sessionConfig);
    console.log(`[Orchestrator] Stream mode for ${event.channel}: ${streamMode}`);

    // 5. Collect response using proper event lifecycle
    let currentMessageText = "";
    const completedMessages: string[] = [];
    
    // Callback to capture tool results so they can be relayed with MEDIA: attachments
    const toolResultCallback = (result: string) => {
      completedMessages.push(result);
    };

    // 6. Create a fresh pi session per message (context comes from our DB,
    //    so there's no need to persist pi's internal message history)
    this.logToFile(`[processMessage] Creating Pi session...`);
    const piSession = await this.createPiSession(systemPrompt, toolResultCallback);
    this.logToFile(`[processMessage] Pi session created`);

    // Register active session so it can be aborted on interrupt
    const sessionKey = `${event.channel}:${event.target}`;
    const activeEntry = { piSession, aborted: false };
    this.activeSessions.set(sessionKey, activeEntry);

    // Start typing indicator if available
    await handler?.startTyping?.();
    this.logToFile(`[processMessage] Typing indicator started`);

    const unsubscribe = piSession.subscribe(
      (agentEvent: AgentSessionEvent) => {
        this.logToFile(`[piSession] Event type: ${agentEvent.type}`);
        switch (agentEvent.type) {
          case "message_start":
            // New message boundary — reset accumulator
            this.logToFile(`[piSession] message_start - message role: ${agentEvent.message?.role || 'unknown'}`);
            currentMessageText = "";
            break;

          case "message_update": {
            const msgEvent = agentEvent.assistantMessageEvent;
            if (msgEvent.type === "text_delta") {
              currentMessageText += msgEvent.delta;
              this.logToFile(`[piSession] text_delta: "${msgEvent.delta}"`);
              if (streamMode === "stream" && handler) {
                handler.relay(msgEvent.delta).catch(() => {});
              }
            }
            break;
          }

          case "message_end":
            // Message fully received — store it as a discrete unit
            this.logToFile(`[piSession] message_end - role: ${agentEvent.message.role}, length: ${currentMessageText.length}`);
            if (agentEvent.message.role === "assistant" && currentMessageText) {
              this.logToFile(`[piSession] FULL ASSISTANT MESSAGE:\n${currentMessageText}\n===END ASSISTANT MESSAGE===`);
              completedMessages.push(currentMessageText);

              // Insert assistant message into DB immediately
              this.queries.insertMessage({
                session_id: vitoSession.id,
                channel: event.channel,
                channel_target: event.target,
                timestamp: Date.now(),
                role: "assistant",
                content: JSON.stringify(currentMessageText),
                compacted: 0,
              });
              this.logToFile(`[piSession] Assistant message stored in DB`);

              // In stream mode, flush each message as it completes
              // then re-send typing indicator since the agent is still working
              if (streamMode === "stream" && handler) {
                this.logToFile(`[piSession] Stream mode: calling endMessage() and restarting typing`);
                handler.endMessage?.()?.catch(() => {});
                handler.startTyping?.()?.catch(() => {});
              }
            }
            currentMessageText = "";
            break;

          case "tool_execution_start":
            this.logToFile(`[piSession] Tool start: ${agentEvent.toolName} (${agentEvent.toolCallId})`);
            this.queries.insertMessage({
              session_id: vitoSession.id,
              channel: event.channel,
              channel_target: event.target,
              timestamp: Date.now(),
              role: "tool",
              content: JSON.stringify({
                phase: "start",
                toolName: agentEvent.toolName,
                toolCallId: agentEvent.toolCallId,
                args: agentEvent.args,
              }),
              compacted: 0,
            });
            handler?.relayEvent?.({
              kind: "tool_start",
              toolName: agentEvent.toolName,
              toolCallId: agentEvent.toolCallId,
              args: agentEvent.args,
            })?.catch(() => {});
            break;

          case "tool_execution_end":
            this.logToFile(`[piSession] Tool end: ${agentEvent.toolName} (error: ${agentEvent.isError})`);
            this.queries.insertMessage({
              session_id: vitoSession.id,
              channel: event.channel,
              channel_target: event.target,
              timestamp: Date.now(),
              role: "tool",
              content: JSON.stringify({
                phase: "end",
                toolName: agentEvent.toolName,
                toolCallId: agentEvent.toolCallId,
                result: agentEvent.result,
                isError: agentEvent.isError,
              }),
              compacted: 0,
            });
            handler?.relayEvent?.({
              kind: "tool_end",
              toolName: agentEvent.toolName,
              toolCallId: agentEvent.toolCallId,
              result: agentEvent.result,
              isError: agentEvent.isError,
            })?.catch(() => {});
            break;
        }
      }
    );

    let llmError: string | null = null;

    try {
      // 7. Send prompt to pi (include attachment file paths if any)
      let promptText = event.content || "";
      if (event.attachments?.length) {
        const refs = event.attachments
          .map((a) => `[Attached ${a.type}: ${a.path}]`)
          .join("\n");
        promptText = promptText ? `${promptText}\n\n${refs}` : refs;
      }

      // Log the full prompt to a file for inspection
      this.logPromptToFile(systemPrompt, promptText);
      this.logToFile(`[processMessage] Sending prompt to LLM... (length: ${promptText.length})`);

      // Wrap the prompt call with a timeout (5 minutes default)
      const timeoutMs = this.config.llmTimeoutMs ?? 5 * 60 * 1000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`LLM call timed out after ${timeoutMs / 1000}s`)), timeoutMs);
      });

      await Promise.race([piSession.prompt(promptText), timeoutPromise]);
      this.logToFile(`[processMessage] LLM response completed successfully`);
      this.logToFile(`[processMessage] Completed messages count: ${completedMessages.length}`);
      llmError = null;
    } catch (err) {
      // Handle abort gracefully (user interrupted)
      if (activeEntry.aborted) {
        this.logToFile(`[processMessage] Session was aborted by user interrupt`);
        console.log(`[Orchestrator] ⛔ Session ${sessionKey} aborted by user`);
        
        // Store an assistant message noting the interruption
        this.queries.insertMessage({
          session_id: vitoSession.id,
          channel: event.channel,
          channel_target: event.target,
          timestamp: Date.now(),
          role: "assistant",
          content: JSON.stringify("*(interrupted)*"),
          compacted: 0,
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
        this.logToFile(`[processMessage] ERROR during LLM call: ${llmError}`);
        console.error(`[Orchestrator] Error during LLM call: ${llmError}`);
        
        // Send error message to user
        if (handler) {
          await handler.relay(`⚠️ ${llmError}`);
          await handler.endMessage?.();
        }
      }
    } finally {
      this.logToFile(`[processMessage] Cleaning up Pi session...`);
      this.activeSessions.delete(sessionKey);
      unsubscribe();
      piSession.dispose();
      await handler?.stopTyping?.();
      this.logToFile(`[processMessage] Pi session disposed`);
    }

    // If there was an error, skip normal response handling
    if (llmError) {
      return;
    }

    // 8. Relay responses for non-stream modes
    this.logToFile(`[processMessage] Relaying response - mode: ${streamMode}, messages: ${completedMessages.length}`);
    if (handler) {
      if (streamMode === "bundled") {
        // Send all messages combined as one blob after the agent loop finishes
        const combined = completedMessages.join("\n\n");
        await handler.relay(combined);
        await handler.endMessage?.();
        this.logToFile(`[processMessage] Bundled response sent`);
      } else if (streamMode === "final" && completedMessages.length > 0) {
        // Send only the final message
        const last = completedMessages[completedMessages.length - 1];
        await handler.relay(last);
        await handler.endMessage?.();
        this.logToFile(`[processMessage] Final response sent`);
      }
    }

    // 9. Assistant messages already inserted in message_end event handler above

    // 10. Signal the channel that the response is complete (for re-prompting)
    if (channel) {
      this.notifyResponseComplete(channel);
      this.logToFile(`[processMessage] Response complete notification sent`);
    }

    // 11. Check if compaction is needed (run in background)
    if (shouldCompact(this.queries, this.config)) {
      this.logToFile(`[processMessage] Compaction threshold reached, running in background...`);
      console.log("\nCompaction threshold reached, running memory compaction...");
      runCompaction(this.queries, this.config, async (prompt) => {
        const { session: compactionSession } = await createAgentSession({
          sessionManager: PiSessionManager.inMemory(),
          model: this.getModel(),
          tools: [],
        });

        let response = "";
        compactionSession.subscribe((e: AgentSessionEvent) => {
          if (
            e.type === "message_update" &&
            e.assistantMessageEvent.type === "text_delta"
          ) {
            response += e.assistantMessageEvent.delta;
          }
        });

        await compactionSession.prompt(prompt);
        compactionSession.dispose();
        return response;
      })
        .then(() => {
          console.log("Compaction complete.");
          this.logToFile(`[processMessage] Compaction completed successfully`);
        })
        .catch((err) => {
          console.error("Compaction failed:", err);
          this.logToFile(`[processMessage] Compaction FAILED: ${err}`);
        });
    }
    
    this.logToFile(`[processMessage] END - message processing complete`);
  }

  private async handleNewCommand(
    event: InboundEvent,
    channel: Channel
  ): Promise<void> {
    const vitoSession = this.sessionManager.resolveSession(
      event.channel,
      event.target
    );

    // Get all uncompacted messages for this session
    const uncompacted = this.queries.getAllUncompactedMessages()
      .filter(m => m.session_id === vitoSession.id);

    if (uncompacted.length === 0) {
      const handler = channel.createHandler(event);
      await handler.relay(
        "✅ Already starting fresh! No messages to compact."
      );
      return;
    }

    const handler = channel.createHandler(event);
    await handler.startTyping?.();

    try {
      // Force compaction for this session
      console.log(`\n[/new] Compacting ${uncompacted.length} messages for session ${vitoSession.id}...`);
      
      await runCompaction(this.queries, this.config, async (prompt) => {
        const { session: compactionSession } = await createAgentSession({
          sessionManager: PiSessionManager.inMemory(),
          model: this.getModel(),
          tools: [],
        });

        let response = "";
        compactionSession.subscribe((e: AgentSessionEvent) => {
          if (
            e.type === "message_update" &&
            e.assistantMessageEvent.type === "text_delta"
          ) {
            response += e.assistantMessageEvent.delta;
          }
        });

        await compactionSession.prompt(prompt);
        compactionSession.dispose();
        return response;
      });

      console.log(`[/new] Compaction complete for session ${vitoSession.id}`);

      await handler.stopTyping?.();
      await handler.relay(
        `✅ **Fresh start initiated!**\n\nCompacted ${uncompacted.length} message(s) into long-term memory. The conversation transcript has been cleared, but all messages are preserved in the database and available for memory formation.\n\nReady for a new conversation! 🚀`
      );
    } catch (err) {
      await handler.stopTyping?.();
      console.error("[/new] Compaction failed:", err);
      await handler.relay(
        "❌ Sorry, something went wrong while compacting messages. Please try again."
      );
    }
  }

  private async handleReloadCommand(
    event: InboundEvent,
    channel: Channel
  ): Promise<void> {
    const handler = channel.createHandler(event);
    const skills = this.getSkills();
    const loadedSkills = await loadSkillTools(this.skillsDir);
    const toolCount = loadedSkills.reduce((sum, s) => sum + s.tools.length, 0);

    await handler.relay(
      `Skills are always loaded from disk on each message.\n\n**Current:** ${skills.length} skill(s) with ${toolCount} tool(s)`
    );
  }

  private notifyResponseComplete(channel: Channel): void {
    // Hook for channels that need post-response actions (e.g. re-prompting)
    if ("reprompt" in channel && typeof (channel as any).reprompt === "function") {
      (channel as any).reprompt();
    }
  }

  private async createPiSession(
    systemPrompt: string,
    toolResultCallback?: (result: string) => void
  ): Promise<AgentSession> {
    this.logToFile(`[createPiSession] Creating new Pi session`);
    
    const resourceLoader = new DefaultResourceLoader({
      cwd: process.cwd(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt,
    });
    await resourceLoader.reload();
    this.logToFile(`[createPiSession] Resource loader initialized`);

    const loadedSkills = await loadSkillTools(this.skillsDir);
    this.logToFile(`[createPiSession] Loaded ${loadedSkills.length} skills`);
    
    const customTools = convertToolsForPi(loadedSkills, toolResultCallback);
    this.logToFile(`[createPiSession] Converted tools for Pi`);

    const { session: piSession } = await createAgentSession({
      sessionManager: PiSessionManager.inMemory(),
      model: this.getModel(),
      resourceLoader,
      customTools,
      thinkingLevel: "off",
    });
    this.logToFile(`[createPiSession] Pi session created successfully`);

    return piSession;
  }

  private buildSystemPrompt(
    contextPrompt: string,
    skillsPrompt: string,
    channelPrompt: string
  ): string {
    const parts: string[] = [];

    if (this.soul) {
      parts.push(this.soul);
    }

    // Inject SYSTEM.md for architecture/system knowledge
    try {
      const systemMdPath = resolve(process.cwd(), "SYSTEM.md");
      if (existsSync(systemMdPath)) {
        const systemMd = readFileSync(systemMdPath, "utf-8");
        parts.push(systemMd);
      }
    } catch (err) {
      console.error("[Orchestrator] Failed to read SYSTEM.md:", err);
    }

    if (skillsPrompt) {
      parts.push(skillsPrompt);
    }

    if (channelPrompt) {
      parts.push(channelPrompt);
    }

    if (contextPrompt) {
      parts.push(
        "## Memory Context\n\nThe following is your memory and conversation context. Use it to maintain continuity.\n\n" +
          contextPrompt
      );
    }

    return parts.join("\n\n---\n\n");
  }

  private getStreamMode(channelName: string, sessionConfig?: SessionConfig): StreamMode {
    return sessionConfig?.streamMode || this.config.channels[channelName]?.streamMode || "final";
  }

  private getModel() {
    const { provider, name } = this.config.model;
    return getModel(provider as any, name as any);
  }

  private currentLogFile: string | null = null;

  private logToFile(message: string): void {
    try {
      const logDir = join(process.cwd(), "logs");
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }

      // Use the current log file or create a new one
      if (!this.currentLogFile) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        this.currentLogFile = join(logDir, `vito-${timestamp}.log`);
      }

      const timestamp = new Date().toISOString();
      const logLine = `[${timestamp}] ${message}\n`;
      
      // Append to the log file
      appendFileSync(this.currentLogFile, logLine, "utf-8");
    } catch (err) {
      console.error(`[Orchestrator] Failed to write to log file:`, err);
    }
  }

  private logPromptToFile(systemPrompt: string, userMessage: string): void {
    try {
      const logDir = join(process.cwd(), "logs");
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filePath = join(logDir, `prompt-${timestamp}.txt`);
      const content =
        `=== SYSTEM PROMPT (${systemPrompt.length} chars) ===\n\n` +
        systemPrompt +
        `\n\n=== USER MESSAGE ===\n\n` +
        userMessage +
        `\n`;
      writeFileSync(filePath, content, "utf-8");
      console.log(`[Orchestrator] Prompt logged to ${filePath}`);
      this.logToFile(`[logPromptToFile] Written to ${filePath}`);
    } catch (err) {
      console.error(`[Orchestrator] Failed to write prompt file:`, err);
    }
  }
}


