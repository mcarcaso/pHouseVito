import { CronScheduler } from "./cron/scheduler.js";
import type { Queries } from "./db/queries.js";
import { PiHarness, withPersistence, withRelay, withTracing, withTyping, type Harness } from "./harnesses/index.js";
import { withNoReplyCheck } from "./harness/decorators/index.js";
import { getDirectChannel, type DirectChannel } from "./channels/direct.js";

import { runAutoClassifier } from "./memory/auto-classifier.js";
import { assembleContext, formatContextForPrompt, extractMessageText } from "./memory/context.js";
import { maybeEmbedNewChunks } from "./memory/embeddings.js";
import { loadProfileForPrompt, maybeUpdateProfile, setProfileUpdaterConfig, setProfileUpdaterQueries } from "./memory/profile.js";
import { autoSearchForContext, type AutoSearchResult } from "./memory/search.js";
import { SessionManager } from "./sessions/manager.js";
import { getEffectiveSettings } from "./settings.js";
import { discoverSkills, formatSkillsForPrompt } from "./skills/discovery.js";
import { buildSystemBlock, getDateTimeString } from "./system-instructions.js";

import { randomBytes } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import {
  buildPromptText,
} from "./types.js";
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
  channelPrompt: string = "",
  botName?: string,
  timezone?: string
): string {
  const parts: string[] = [];

  parts.push(getDateTimeString(timezone));

  if (soul) {
    parts.push(`<personality>\n${soul}\n</personality>`);
  }

  // No commands in test prompts (no /new etc.)
  parts.push(buildSystemBlock(false, botName));

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

    // Initialize profile updater with config and queries reference
    setProfileUpdaterConfig(config);
    setProfileUpdaterQueries(queries);

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
  reloadCronJobs(jobs: CronJobConfig[], timezone?: string): void {
    if (timezone) {
      this.cronScheduler.setTimezone(timezone);
    }
    this.cronScheduler.reload(jobs);
  }

  /** Hot-reload the full config (model, memory, etc.) */
  reloadConfig(config: VitoConfig): void {
    this.config = config;
    setProfileUpdaterConfig(config);  // Keep profile updater in sync
    const defaultHarness = config.settings?.harness || "pi-coding-agent";
    console.log(`[Orchestrator] Config reloaded — default harness: ${defaultHarness}`);
  }

  /**
   * Public API: Ask a question and get a text response.
   * Routes through the FULL orchestrator pipeline (system prompt, memories, semantic search, 
   * skills, harness decorators) via the DirectChannel — no drift, no missing features.
   * 
   * Used by external integrations (Bland.ai phone, future Slack/webhooks, etc.)
   */
  async ask(options: {
    question: string;
    session?: string;      // e.g. "api:bland-mike" — defaults to "api:default"
    author?: string;       // who's asking — defaults to "api"
    channelPrompt?: string; // custom channel instructions (e.g. "keep it brief for phone")
  }): Promise<string> {
    // Ensure DirectChannel is ready before using it
    await this.ensureDirectChannelReady();
    const directChannel = this.getDirectChannel();
    
    try {
      const response = await directChannel.ask({
        question: options.question,
        session: options.session,
        author: options.author,
        channelPrompt: options.channelPrompt,
      });
      return response || "I couldn't come up with an answer for that one.";
    } catch (err) {
      console.error(`[Orchestrator.ask] Error: ${err instanceof Error ? err.message : err}`);
      return "I hit a snag trying to think about that. Try asking again.";
    }
  }

  /** DirectChannel instance for programmatic API access */
  private directChannel: DirectChannel | null = null;
  private directChannelReady: Promise<void> | null = null;

  /**
   * Get the DirectChannel instance, ensuring it's started.
   * Lazy initialization — first call sets it up.
   */
  private getDirectChannel(): DirectChannel {
    if (!this.directChannel) {
      this.directChannel = getDirectChannel();
      this.registerChannel(this.directChannel);
      
      // Start and wire up listener (store promise so we can await it)
      this.directChannelReady = (async () => {
        await this.directChannel!.start();
        await this.directChannel!.listen((event) => this.handleInbound(event, this.directChannel!));
      })();
    }
    return this.directChannel;
  }

  /**
   * Ensure DirectChannel is ready before use.
   */
  private async ensureDirectChannelReady(): Promise<void> {
    this.getDirectChannel(); // Initialize if needed
    if (this.directChannelReady) {
      await this.directChannelReady;
    }
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

    parts.push(getDateTimeString(this.config.settings?.timezone));

    if (this.soul) {
      parts.push(`<personality>\n${this.soul}\n</personality>`);
    }

    // No commands in test prompts (no /new etc.)
    parts.push(buildSystemBlock(false, this.config.bot?.name));

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
    
    const imagesDir = resolve(process.cwd(), "user/drive/images");
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
    
    // Start cron scheduler with configured timezone
    const timezone = this.config.settings?.timezone;
    this.cronScheduler.start(this.config.cron.jobs, timezone);
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
    // Use the session key from the event (includes thread IDs for forum topics)
    const sessionKey = event.sessionKey;
    console.log(`[handleInbound] ⚡ Received event from ${sessionKey}, content: "${event.content?.slice(0, 50)}"`);

    // PRIORITY: /stop command bypasses queue entirely — handle immediately
    if (channel && event.content?.trim() === '/stop') {
      console.log(`[handleInbound] 🛑 /stop command detected — bypassing queue`);
      await this.handleStopCommand(event, channel);
      return;
    }

    // PRIORITY: /restart command bypasses queue — restarts the server
    if (channel && event.content?.trim() === '/restart') {
      console.log(`[handleInbound] 🔄 /restart command detected — bypassing queue`);
      await this.handleRestartCommand(event, channel);
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

    // 1. Resolve/create session — sessionKey is built by the channel
    const vitoSession = this.sessionManager.resolveSession(event.sessionKey);

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

    // 2.5. Check if we should respond based on requireMention setting
    // Use event.sessionKey (which may include threadId for Telegram topics) for settings lookup
    const effectiveSettings = getEffectiveSettings(this.config, event.channel, event.sessionKey);
    const requireMention = effectiveSettings.requireMention !== false; // default true
    const hasMention = event.hasMention !== false; // default true if not set (backward compat)
    
    if (requireMention && !hasMention) {
      console.log(`[Orchestrator] requireMention=true but hasMention=false, storing message without AI response`);
      this.queries.insertMessage({
        session_id: vitoSession.id,
        channel: event.channel,
        channel_target: event.target,
        timestamp: event.timestamp,
        type: "user",
        content: JSON.stringify(userContent),
        archived: 0,
        author: event.author ?? null,
      });
      return;
    }

    // 3. Log effective settings (already computed above for requireMention check)
    console.log(`[Orchestrator] Effective settings for ${event.sessionKey}: harness=${effectiveSettings.harness}, streamMode=${effectiveSettings.streamMode}, traceMessageUpdates=${effectiveSettings.traceMessageUpdates}, currentContext.limit=${effectiveSettings.currentContext.limit}, crossContext.limit=${effectiveSettings.crossContext.limit}`);

    // 3.5. If any auto flags are set, run the cheap classifier and overlay decisions
    //      onto effectiveSettings before context assembly / memory search / harness creation.
    const auto = effectiveSettings.auto;
    const anyAuto =
      auto.currentContext.limit ||
      auto.currentContext.includeThoughts ||
      auto.currentContext.includeTools ||
      auto.memory.recalledMemoryLimit ||
      auto["pi-coding-agent"].model;

    if (anyAuto) {
      // Build a numbered chronological history snippet (last N user/assistant
      // messages, no tools/thoughts). Each line is prefixed with [-K] where
      // K is its distance from "now" — [-1] is the most recent past message,
      // [-2] is two back, etc. The classifier uses these offsets to pick
      // currentContextLimit concretely instead of guessing abstract numbers.
      const RECENT_WINDOW = 25;
      const recent = this.queries.getRecentMessages(vitoSession.id, RECENT_WINDOW, false, false, false);
      const totalSessionMessages = this.queries.countMessagesForSession(vitoSession.id, true, true);
      const historyLines: string[] = [];
      for (let i = 0; i < recent.length; i++) {
        try {
          const text = extractMessageText(recent[i].content);
          if (!text) continue;
          const role = recent[i].type === "user" ? "user" : "assistant";
          const authorPrefix = (recent[i].type === "user" && recent[i].author)
            ? `${recent[i].author}: `
            : "";
          const offset = recent.length - i; // last entry → 1, first entry → recent.length
          historyLines.push(`[-${offset}] ${role}: ${authorPrefix}${text.slice(0, 300)}`);
        } catch {
          // skip malformed rows
        }
      }
      const recentHistory = historyLines.length > 0
        ? `Window: showing the ${recent.length} most recent message(s) of ${totalSessionMessages} total in this session. Each line is tagged with its distance from the new message — [-1] is the message just before it, [-2] is two back, and so on.\n\n${historyLines.join("\n")}`
        : undefined;

      const classified = await runAutoClassifier({
        userMessage: event.content || "",
        author: event.author,
        attachments: event.attachments,
        recentHistory,
        modelChoices: auto["pi-coding-agent"].modelChoices,
        classifierModel: auto.classifierModel,
        needed: {
          model: auto["pi-coding-agent"].model,
          currentContextLimit: auto.currentContext.limit,
          currentContextIncludeThoughts: auto.currentContext.includeThoughts,
          currentContextIncludeTools: auto.currentContext.includeTools,
          recalledMemoryLimit: auto.memory.recalledMemoryLimit,
        },
        trace: {
          session_id: vitoSession.id,
          channel: event.channel,
          target: event.target,
        },
      });

      if (classified.ran) {
        const applied: string[] = [];
        if (auto.currentContext.limit && classified.currentContextLimit !== undefined) {
          effectiveSettings.currentContext.limit = classified.currentContextLimit;
          applied.push(`currentContext.limit=${classified.currentContextLimit}`);
        }
        if (auto.currentContext.includeThoughts && classified.currentContextIncludeThoughts !== undefined) {
          effectiveSettings.currentContext.includeThoughts = classified.currentContextIncludeThoughts;
          applied.push(`currentContext.includeThoughts=${classified.currentContextIncludeThoughts}`);
        }
        if (auto.currentContext.includeTools && classified.currentContextIncludeTools !== undefined) {
          effectiveSettings.currentContext.includeTools = classified.currentContextIncludeTools;
          applied.push(`currentContext.includeTools=${classified.currentContextIncludeTools}`);
        }
        if (auto.memory.recalledMemoryLimit && classified.recalledMemoryLimit !== undefined) {
          effectiveSettings.memory.recalledMemoryLimit = classified.recalledMemoryLimit;
          applied.push(`memory.recalledMemoryLimit=${classified.recalledMemoryLimit}`);
        }
        if (auto["pi-coding-agent"].model && classified.selectedModel) {
          const piModel = classified.selectedModel;
          effectiveSettings["pi-coding-agent"] = {
            ...(effectiveSettings["pi-coding-agent"] || {}),
            model: piModel,
          };
          applied.push(`pi-coding-agent.model=${piModel.provider}/${piModel.name}`);
        }
        console.log(`[Orchestrator] 🤖 Auto classifier (${classified.durationMs}ms) applied: ${applied.join(", ") || "(nothing)"}${classified.tracePath ? ` — trace: ${classified.tracePath}` : ""}`);
        if (classified.explanation) {
          console.log(`[Orchestrator] 🤖 Auto classifier reasoning: ${classified.explanation}`);
        }
      } else {
        console.warn(`[Orchestrator] 🤖 Auto classifier skipped: ${classified.note}${classified.tracePath ? ` — trace: ${classified.tracePath}` : ""}`);
      }
    }

    // 4. Build fresh context (uses effective settings for memory limits)
    const ctx = await assembleContext(
      this.queries,
      vitoSession.id,
      this.config,
      effectiveSettings
    );
    const contextPrompt = formatContextForPrompt(ctx);
    const skillsPrompt = formatSkillsForPrompt(this.getSkills());

    // 4.5. Auto-search embeddings for relevant historical context
    let recalledMemories = "";
    let memorySearchTrace: AutoSearchResult["trace"] | null = null;
    try {
      const rawQuery = event.content?.trim() || "";
      const searchResult = await autoSearchForContext(rawQuery, { memory: effectiveSettings.memory });
      recalledMemories = searchResult.text;
      memorySearchTrace = searchResult.trace;
      if (recalledMemories) {
        console.log(`[Search] Auto-search found ${searchResult.trace.results_injected} relevant memories in ${searchResult.trace.duration_ms}ms for: "${rawQuery.slice(0, 60)}..."`);
      } else if (searchResult.trace.skipped) {
        console.log(`[Search] Auto-search skipped: ${searchResult.trace.skipped}`);
      }
    } catch (err) {
      console.error(`[Search] Auto-search failed:`, err);
    }

    // 5. Set up output handler and message tracking
    const baseHandler = channel ? channel.createHandler(event) : null;
    
    // Check if this is a cron job with sendCondition
    const sendCondition = event.raw?.sendCondition as string | null;
    
    // Check if this is a DirectChannel API request (needs final mode to capture response)
    const isDirectChannel = event.raw?.source === "direct-channel";
    
    // If sendCondition is set, wrap handler with NO_REPLY check and force streamMode to 'final'
    // Also force 'final' mode for DirectChannel so we only capture the final response
    let handler = baseHandler;
    let streamMode = effectiveSettings.streamMode;
    if (sendCondition) {
      handler = withNoReplyCheck(baseHandler);
      streamMode = 'final';
      console.log(`[Orchestrator] sendCondition detected, wrapping handler with NO_REPLY check, forcing streamMode=final`);
    } else if (isDirectChannel) {
      streamMode = 'final';
      console.log(`[Orchestrator] DirectChannel detected, forcing streamMode=final`);
    }

    // Create harness for this request (respects cascaded settings)
    // Build decorator chain: harness → tracing → persistence → relay
    const innerHarness = this.getHarness(effectiveSettings);
    const tracedHarness = withTracing(innerHarness, {
      session_id: vitoSession.id,
      channel: event.channel,
      target: event.target,
      model: this.getModelString(effectiveSettings),
      traceMessageUpdates: effectiveSettings.traceMessageUpdates ?? false,
    });

    // Inject memory search trace data (queued for writing when trace file is created)
    if (memorySearchTrace) {
      tracedHarness.writePreRunLine({
        type: "memory_search",
        query: memorySearchTrace.query,
        duration_ms: memorySearchTrace.duration_ms,
        results_found: memorySearchTrace.results_found,
        results_injected: memorySearchTrace.results_injected,
        results: memorySearchTrace.results,
        skipped: memorySearchTrace.skipped,
      });
    }

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
    // Check for per-request channel prompt override (used by DirectChannel/API calls)
    const channelPrompt = event.raw?.channelPrompt || channel?.getCustomPrompt?.() || "";
    const systemPrompt = this.buildSystemPrompt(
      contextPrompt,
      skillsPrompt,
      channelPrompt,
      innerHarness.getCustomInstructions?.() || "",
      recalledMemories,
      effectiveSettings.customInstructions || ""
    );

    // Set up abort controller for this request
    const abortController = new AbortController();
    const activeEntry = { abort: abortController, aborted: false };
    this.activeRequests.set(event.sessionKey, activeEntry);

    // Build user message (include sender name and attachment file paths if any)
    const promptText = buildPromptText(event.content, {
      author: event.author,
      attachments: event.attachments,
    });

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
      this.activeRequests.delete(event.sessionKey);
    }

    // Signal the channel that the response is complete (for re-prompting)
    if (channel) {
      this.notifyResponseComplete(channel);
    }

    // Background: check if we should embed new chunks for this session
    maybeEmbedNewChunks(vitoSession.id).then((embResult) => {
      if (embResult) {
        tracedHarness.writePostRunLine({
          type: "embedding_result",
          skipped: embResult.skipped,
          chunks_created: embResult.chunks_created,
          chunks: embResult.chunks,
          unembedded_messages: embResult.unembedded_messages,
          unembedded_chars: embResult.unembedded_chars,
          duration_ms: embResult.duration_ms,
        });
      }
    }).catch((err) => {
      console.error(`[Embeddings] Background embedding failed:`, err);
    });

    // Background: check if the conversation revealed profile-worthy facts
    // Pass the session ID so the profile updater can fetch recent conversation context
    const currentUserMessage = event.content || "";
    maybeUpdateProfile(vitoSession.id, currentUserMessage).then((profResult) => {
      if (profResult) {
        tracedHarness.writePostRunLine({
          type: "profile_update",
          skipped: profResult.skipped,
          updated: profResult.updated,
          duration_ms: profResult.duration_ms,
          traceFile: profResult.traceFile,  // Link to the separate trace file
        });
      }
    }).catch((err) => {
      console.error(`[Profile] Background profile update failed:`, err);
    });

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

    // Force-release the session lock — this is the escape hatch for stuck sessions
    const wasLocked = this.sessionProcessing.has(sessionKey);
    if (wasLocked) {
      this.sessionProcessing.delete(sessionKey);
      console.log(`[/stop] 🔓 Force-released session lock for ${sessionKey}`);
    }

    // Send confirmation
    const parts: string[] = [];
    if (aborted) {
      parts.push("⛔ Stopped current request");
    }
    if (queuedCount > 0) {
      parts.push(`🗑️ Cleared ${queuedCount} queued message${queuedCount > 1 ? 's' : ''}`);
    }
    if (wasLocked && !aborted) {
      // Lock was held but no active request — this is the "stuck" scenario
      parts.push("🔓 Released stuck session lock");
    }
    
    const message = parts.length === 0 
      ? "✅ Nothing to stop — all clear, boss."
      : parts.join('\n');
    
    console.log(`[/stop] Sending response: "${message}"`);
    await handler.relay(message);

    // Flush the buffer so the message actually gets sent (important for slash commands)
    console.log(`[/stop] Flushing buffer (stopTyping)`);
    await handler.stopTyping?.();

    console.log(`[/stop] ✅ Complete. Session ${sessionKey}: aborted=${aborted}, cleared=${queuedCount}, lockReleased=${wasLocked}`);
  }

  private async handleRestartCommand(
    event: InboundEvent,
    channel: Channel
  ): Promise<void> {
    const { spawn } = await import('child_process');
    const handler = channel.createHandler(event);

    console.log(`[/restart] 🔄 Restart command received`);

    // Send confirmation BEFORE restarting
    await handler.relay("🔄 Restarting in 5 seconds...");
    await handler.stopTyping?.();

    // Spawn a bash script that waits 5 seconds then restarts
    // This gives the message time to actually get sent
    console.log(`[/restart] Spawning delayed restart (5 seconds)`);
    const child = spawn('bash', ['-c', 'sleep 5 && pm2 restart vito-server'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    console.log(`[/restart] Delayed restart scheduled, message should be delivered`);
  }

  private async handleNewCommand(
    event: InboundEvent,
    channel: Channel
  ): Promise<void> {
    const vitoSession = this.sessionManager.resolveSession(event.sessionKey);

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
      // Step 1: Force embeddings for any remaining unembedded messages
      console.log(`\n[/new] Forcing embeddings for session ${vitoSession.id}...`);
      const embResult = await maybeEmbedNewChunks(vitoSession.id, { force: true });
      if (embResult?.skipped) {
        console.log(`[/new] Embeddings skipped: ${embResult.skipped}`);
      } else {
        console.log(`[/new] Embeddings complete: ${embResult.chunks_created} chunk(s)`);
      }

      // Step 2: Archive ALL messages in this session
      this.queries.markSessionArchived(vitoSession.id);
      console.log(`[/new] All messages archived for session ${vitoSession.id}`);

      await handler.stopTyping?.();
      const embedLine = embResult?.skipped
        ? `Embeddings: ${embResult.skipped.replace(/_/g, " ")}.\n`
        : `Embedded ${embResult?.chunks_created ?? 0} chunk(s).\n`;

      await handler.relay(
        `✅ **Fresh start!**\n\n${embedLine}All messages archived. Same session, clean slate.\n\nReady for a new conversation! 🚀`
      );
    } catch (err) {
      await handler.stopTyping?.();
      console.error("[/new] Embedding/archive failed:", err);
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

  private buildSystemPrompt(
    contextPrompt: string,
    skillsPrompt: string,
    channelPrompt: string,
    harnessInstructions: string = "",
    recalledMemories: string = "",
    customInstructions: string = ""
  ): string {
    const parts: string[] = [];

    parts.push(getDateTimeString(this.config.settings?.timezone));

    if (this.soul) {
      parts.push(`<personality>\n${this.soul}\n</personality>`);
    }

    // Include commands for interactive sessions
    parts.push(buildSystemBlock(true, this.config.bot?.name));

    if (skillsPrompt) {
      parts.push(`<skills>\n${skillsPrompt}\n</skills>`);
    }

    if (channelPrompt) {
      parts.push(`<channel>\n${channelPrompt}\n</channel>`);
    }

    // Inject harness-specific instructions if they exist (before memory)
    if (harnessInstructions) {
      parts.push(`<harness-instructions>\n${harnessInstructions}\n</harness-instructions>`);
    }

    // Inject user-defined custom instructions (cascaded: Global → Channel → Session)
    if (customInstructions) {
      parts.push(`<custom-instructions>\n${customInstructions}\n</custom-instructions>`);
    }

    // User profile — structured semantic memory, always injected
    const profilePrompt = loadProfileForPrompt();
    if (profilePrompt) {
      parts.push(`<user-profile>\n${profilePrompt}\n</user-profile>`);
    }

    if (recalledMemories) {
      parts.push(`<recalled-memories>\nThese are historical conversation chunks retrieved from long-term memory via semantic search. They may contain relevant context for the current conversation.\n\n${recalledMemories}\n</recalled-memories>`);
    }

    if (contextPrompt) {
      parts.push(`<memory>\n${contextPrompt}\n</memory>`);
    }

    // Anchor the user's message to the current conversation thread
    parts.push(`The user's message is a direct response to the last message in <current-session>. Treat the current session as the primary conversational thread. <recalled-memories> provides historical context but should NOT override the immediate conversation flow.`);

    return parts.join("\n\n");
  }

  /** Get a human-readable model string from resolved settings */
  private getModelString(settings: ResolvedSettings): string {
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


