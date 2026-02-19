import { CronScheduler } from "./cron/scheduler.js";
import type { Queries } from "./db/queries.js";
import { ClaudeCodeHarness, PiHarness, withPersistence, withRelay, withTracing, withTyping, type Harness } from "./harnesses/index.js";
import { withNoReplyCheck } from "./harness/decorators/index.js";
import { shouldCompact, acquireCompactionLock, releaseCompactionLock } from "./memory/compaction.js";
import { assembleContext, formatContextForPrompt } from "./memory/context.js";
import { SessionManager } from "./sessions/manager.js";
import { getEffectiveSettings } from "./settings.js";
import { discoverSkills, formatSkillsForPrompt } from "./skills/discovery.js";
import { buildSystemBlock, getDateTimeString } from "./system-instructions.js";

import { randomBytes } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import type {
  Channel,
  CronJobConfig,
  InboundEvent,
  OutputHandler,
  ResolvedSettings,
  SkillMeta,
  StreamMode,
  VitoConfig
} from "./types.js";


/**
 * Build a system prompt for testing/battle scenarios.
 * Standalone function that doesn't require instantiating the full Orchestrator.
 * 
 * Includes: personality, system instructions, skills, channel prompt
 * Excludes: memory/session context (no cross-session, no current-session)
 */
export function buildTestSystemPrompt(
  soul: string,
  skillsDir: string,
  channelPrompt: string = ""
): string {
  const parts: string[] = [];

  parts.push(getDateTimeString());

  if (soul) {
    parts.push(`<personality>\n${soul}\n</personality>`);
  }

  // No commands in test prompts (no /new etc.)
  parts.push(buildSystemBlock(false));

  // Skills prompt
  const skills = discoverSkills(skillsDir);
  const skillsPrompt = formatSkillsForPrompt(skills);
  if (skillsPrompt) {
    parts.push(`<skills>\n${skillsPrompt}\n</skills>`);
  }

  if (channelPrompt) {
    parts.push(`<channel>\n${channelPrompt}\n</channel>`);
  }

  // Note: NO <memory> section — that's the whole point of this function

  return parts.join("\n\n");
}

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
    const defaultHarness = config.settings?.harness || "claude-code";
    console.log(`[Orchestrator] Config reloaded — default harness: ${defaultHarness}`);
  }

  /**
   * Build a system prompt for testing/battle scenarios.
   * Includes: personality, system instructions, skills, channel prompt
   * Excludes: memory/session context (no cross-session, no current-session)
   * 
   * @param channelPrompt - Optional channel-specific instructions (e.g., "You are responding in Telegram...")
   */
  buildTestSystemPrompt(channelPrompt: string = ""): string {
    const parts: string[] = [];

    parts.push(getDateTimeString());

    if (this.soul) {
      parts.push(`<personality>\n${this.soul}\n</personality>`);
    }

    // No commands in test prompts (no /new etc.)
    parts.push(buildSystemBlock(false));

    // Skills prompt
    const skillsPrompt = formatSkillsForPrompt(this.getSkills());
    if (skillsPrompt) {
      parts.push(`<skills>\n${skillsPrompt}\n</skills>`);
    }

    if (channelPrompt) {
      parts.push(`<channel>\n${channelPrompt}\n</channel>`);
    }

    // Note: NO <memory> section — that's the whole point of this method

    return parts.join("\n\n");
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
    console.log(`[handleInbound] ⚡ Received event from ${sessionKey}, content: "${event.content?.slice(0, 50)}"`);

    // PRIORITY: /stop command bypasses queue entirely — handle immediately
    if (channel && event.content?.trim() === '/stop') {
      console.log(`[handleInbound] 🛑 /stop command detected — bypassing queue`);
      await this.handleStopCommand(event, channel);
      return;
    }

    // Get or create the per-session queue
    if (!this.sessionQueues.has(sessionKey)) {
      this.sessionQueues.set(sessionKey, []);
    }
    const queue = this.sessionQueues.get(sessionKey)!;

    // Queue message (no interrupt, no clearing - messages wait their turn)
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
    // Check for /stop command - clear queue and abort current request
    if (channel && event.content?.trim() === '/stop') {
      await this.handleStopCommand(event, channel);
      return;
    }

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

    // 2. Build user content for DB (paths only, no base64)
    const userContent = event.attachments?.length
      ? {
          text: event.content,
          attachments: event.attachments.map((a) => ({
            type: a.type,
            path: a.path,
            filename: a.filename,
            mimeType: a.mimeType,
          })),
        }
      : event.content;

    // 3. Get effective settings with cascade: Global → Channel → Session
    const sessionKey = `${event.channel}:${event.target}`;
    const effectiveSettings = getEffectiveSettings(this.config, event.channel, sessionKey);
    console.log(`[Orchestrator] Effective settings for ${sessionKey}: harness=${effectiveSettings.harness}, streamMode=${effectiveSettings.streamMode}, currentContext.limit=${effectiveSettings.currentContext.limit}, crossContext.limit=${effectiveSettings.crossContext.limit}`);

    // 4. Build fresh context (uses effective settings for memory limits)
    const ctx = await assembleContext(
      this.queries,
      vitoSession.id,
      this.config,
      effectiveSettings
    );
    const contextPrompt = formatContextForPrompt(ctx);
    const skillsPrompt = formatSkillsForPrompt(this.getSkills());

    // 5. Set up output handler and message tracking
    const baseHandler = channel ? channel.createHandler(event) : null;
    
    // Check if this is a cron job with sendCondition
    const sendCondition = event.raw?.sendCondition as string | null;
    
    // If sendCondition is set, wrap handler with NO_REPLY check and force streamMode to 'final'
    let handler = baseHandler;
    let streamMode = effectiveSettings.streamMode;
    if (sendCondition) {
      handler = withNoReplyCheck(baseHandler);
      streamMode = 'final';
      console.log(`[Orchestrator] sendCondition detected, wrapping handler with NO_REPLY check, forcing streamMode=final`);
    }

    // Create harness for this request (respects cascaded settings)
    // Build decorator chain: harness → tracing → persistence → relay
    const innerHarness = this.getHarness(effectiveSettings);
    const tracedHarness = withTracing(innerHarness, {
      session_id: vitoSession.id,
      channel: event.channel,
      target: event.target,
      model: this.getModelString(effectiveSettings),
    });
    const persistedHarness = withPersistence(tracedHarness, {
      queries: this.queries,
      sessionId: vitoSession.id,
      channel: event.channel,
      target: event.target,
      userContent,
      userTimestamp: event.timestamp,
      author: event.author,
    });
    const relayHarness = withRelay(persistedHarness, { handler, streamMode });
    
    console.log(`[Orchestrator] Stream mode for ${event.channel}: ${streamMode}`);
    const harness = withTyping(relayHarness, handler);

    // Build system prompt with harness-specific custom instructions
    const systemPrompt = this.buildSystemPrompt(
      contextPrompt,
      skillsPrompt,
      channel?.getCustomPrompt?.() || "",
      innerHarness.getCustomInstructions?.() || ""
    );

    // Set up abort controller for this request
    const abortController = new AbortController();
    const activeEntry = { abort: abortController, aborted: false };
    this.activeRequests.set(sessionKey, activeEntry);

    // Build user message (include sender name and attachment file paths if any)
    let promptText = event.content || "";
    
    // Prepend sender name if available (so Claude knows who is talking)
    const senderName = event.author;
    if (senderName && senderName !== "user" && senderName !== "system") {
      promptText = `[${senderName}]: ${promptText}`;
    }
    
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
        { onRawEvent: () => {}, onNormalizedEvent: () => {} },
        abortController.signal
      );
      console.log(`[Orchestrator] LLM response complete`);
    } catch (err) {
      console.error(`[Orchestrator] Error during LLM call: ${err instanceof Error ? err.message : err}`);
      return;
    } finally {
      this.activeRequests.delete(sessionKey);
    }

    // Signal the channel that the response is complete (for re-prompting)
    if (channel) {
      this.notifyResponseComplete(channel);
    }

    // Check if compaction is needed (run in background)
    if (shouldCompact(this.queries, this.config)) {
      const percent = this.config.compaction.percent ?? 50;
      const messageTypes = this.config.compaction.messageTypes;
      const count = Math.ceil(this.queries.countUncompacted(messageTypes) * (percent / 100));
      console.log("\nCompaction threshold reached, triggering compaction skill...");
      this.triggerCompaction(`Compact the oldest ${count} uncompacted messages into long-term memory.`)
        .then(() => {
          console.log("Compaction complete.");
        })
        .catch((err) => {
          console.error("Compaction failed:", err);
        });
    }
  }

  private async handleStopCommand(
    event: InboundEvent,
    channel: Channel
  ): Promise<void> {
    const sessionKey = `${event.channel}:${event.target}`;
    console.log(`[/stop] 🛑 handleStopCommand called for ${sessionKey}`);
    
    const handler = channel.createHandler(event);
    console.log(`[/stop] Handler created`);

    // Clear the queue for this session
    const queue = this.sessionQueues.get(sessionKey);
    const queuedCount = queue?.length || 0;
    console.log(`[/stop] Queue for ${sessionKey}: ${queuedCount} messages`);
    if (queue) {
      queue.length = 0;
    }

    // Abort any active request for this session
    const active = this.activeRequests.get(sessionKey);
    let aborted = false;
    console.log(`[/stop] Active request exists: ${!!active}, already aborted: ${active?.aborted}`);
    if (active && !active.aborted) {
      active.aborted = true;
      active.abort.abort();
      aborted = true;
      console.log(`[/stop] Aborted active request`);
    }

    // Send confirmation
    const parts: string[] = [];
    if (aborted) {
      parts.push("⛔ Stopped current request");
    }
    if (queuedCount > 0) {
      parts.push(`🗑️ Cleared ${queuedCount} queued message${queuedCount > 1 ? 's' : ''}`);
    }
    
    const message = parts.length === 0 
      ? "✅ Nothing to stop — all clear, boss."
      : parts.join('\n');
    
    console.log(`[/stop] Sending response: "${message}"`);
    await handler.relay(message);

    // Flush the buffer so the message actually gets sent (important for slash commands)
    console.log(`[/stop] Flushing buffer (stopTyping)`);
    await handler.stopTyping?.();

    console.log(`[/stop] ✅ Complete. Session ${sessionKey}: aborted=${aborted}, cleared=${queuedCount}`);
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
        
        await this.triggerCompaction(
          `Compact all uncompacted messages from session "${vitoSession.id}" into long-term memory.`
        );

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
   * Trigger compaction by sending a synthetic message to the system:compaction session.
   * This runs compaction like any other task — Pi reads the skill, queries the DB, updates memories.
   * After completion, marks all system:compaction messages as compacted to prevent loops.
   */
  private async triggerCompaction(task: string): Promise<void> {
    // Acquire lock to prevent concurrent compaction
    if (!acquireCompactionLock()) {
      console.log("[Compaction] Already in progress, skipping...");
      return;
    }

    const compactionSession = "system:compaction";
    const compactionChannel = "system";
    const compactionTarget = "compaction";

    try {
      // Create synthetic inbound event for compaction
      const event: InboundEvent = {
        sessionKey: compactionSession,
        channel: compactionChannel,
        target: compactionTarget,
        author: "system",
        content: task,
        timestamp: Date.now(),
        raw: { synthetic: true },
      };

      // Process the compaction message like any other message
      // (but skip the normal compaction check at the end to avoid recursion)
      await this.processCompactionMessage(event);

      // After compaction completes, mark ALL messages in system:compaction as compacted
      // This includes the task message, all tool calls, and the final response
      this.queries.markSessionCompacted(compactionSession);
      console.log(`[Compaction] Marked all system:compaction messages as compacted`);
    } finally {
      releaseCompactionLock();
    }
  }

  /**
   * Process a compaction message — like processMessage but without triggering compaction at the end
   */
  private async processCompactionMessage(event: InboundEvent): Promise<void> {
    // Resolve session (creates system:compaction if needed)
    const vitoSession = this.sessionManager.resolveSession(
      event.channel,
      event.target
    );

    const sessionKey = `${event.channel}:${event.target}`;
    
    // Get effective settings for system compaction session
    const effectiveSettings = getEffectiveSettings(this.config, event.channel, sessionKey);

    // Build context (compaction session will have minimal context)
    const ctx = await assembleContext(
      this.queries,
      vitoSession.id,
      this.config,
      effectiveSettings
    );
    const contextPrompt = formatContextForPrompt(ctx);
    const skillsPrompt = formatSkillsForPrompt(this.getSkills());

    // Create harness with full tool access
    const innerHarness = this.getHarness(effectiveSettings);
    const tracedHarness = withTracing(innerHarness, {
      session_id: vitoSession.id,
      channel: event.channel,
      target: event.target,
      model: this.getModelString(effectiveSettings),
    });
    const persistedHarness = withPersistence(tracedHarness, {
      queries: this.queries,
      sessionId: vitoSession.id,
      channel: event.channel,
      target: event.target,
      userContent: event.content,
      userTimestamp: event.timestamp,
      author: event.author,
    });
    // No relay or typing for system tasks
    const harness = persistedHarness;

    // Build system prompt with compaction-specific channel prompt
    const systemPrompt = this.buildSystemPrompt(
      contextPrompt,
      skillsPrompt,
      "## Channel: System\nYou are running a background system task. No user interaction needed — just complete the task.",
      innerHarness.getCustomInstructions?.() || ""
    );

    console.log(`[Compaction] Sending task to LLM: ${event.content.substring(0, 100)}...`);

    await harness.run(
      systemPrompt,
      event.content,
      { onRawEvent: () => {}, onNormalizedEvent: () => {} }
    );

    console.log(`[Compaction] Task complete`);
  }

  private buildSystemPrompt(
    contextPrompt: string,
    skillsPrompt: string,
    channelPrompt: string,
    harnessInstructions: string = ""
  ): string {
    const parts: string[] = [];

    parts.push(getDateTimeString());

    if (this.soul) {
      parts.push(`<personality>\n${this.soul}\n</personality>`);
    }

    // Include commands for interactive sessions
    parts.push(buildSystemBlock(true));

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

  /** Get a human-readable model string from resolved settings */
  private getModelString(settings: ResolvedSettings): string {
    const harnessName = settings.harness;
    if (harnessName === "claude-code") {
      // Get model from cascaded settings, fallback to global harness config
      const globalCCConfig = this.config.harnesses?.["claude-code"];
      return settings["claude-code"]?.model || globalCCConfig?.model || "sonnet";
    }
    // Pi harness
    const globalPiConfig = this.config.harnesses?.["pi-coding-agent"];
    const model = settings["pi-coding-agent"]?.model || globalPiConfig?.model || 
      { provider: "anthropic", name: "claude-sonnet-4-20250514" };
    return `${model.provider}/${model.name}`;
  }

  /**
   * Create a harness for the given resolved settings.
   * Settings come pre-cascaded: Global → Channel → Session
   */
  private getHarness(settings: ResolvedSettings): Harness {
    const harnessName = settings.harness;
    
    if (harnessName === "claude-code") {
      // Claude Code harness - merge global config with cascaded overrides
      const globalConfig = this.config.harnesses?.["claude-code"] || {};
      const cascadedOverrides = settings["claude-code"] || {};
      
      // Cascaded overrides (from settings cascade) take precedence over global config
      const mergedConfig = { ...globalConfig, ...cascadedOverrides };
      
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
    const globalPiConfig = this.config.harnesses?.["pi-coding-agent"] || {
      model: { provider: "anthropic", name: "claude-sonnet-4-20250514" },
    };
    
    // Apply cascaded overrides
    const cascadedOverrides = settings["pi-coding-agent"] || {};
    const model = cascadedOverrides.model || globalPiConfig.model;
    const thinkingLevel = cascadedOverrides.thinkingLevel || globalPiConfig.thinkingLevel;

    const harness = new PiHarness({
      model,
      thinkingLevel,
      skillsDir: this.skillsDir,
    });

    console.log(`[Orchestrator] 🎭 Created harness: ${harness.getName()} (${model.provider}/${model.name})`);
    return harness;
  }
}


