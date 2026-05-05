/**
 * OrchestratorV2 — simplified message pipeline with long-lived pi sessions.
 *
 * Differences from v1 (src/orchestrator.ts):
 *   - No auto-classifier (gone entirely; per-turn settings come from the cascade only).
 *   - No auto memory recall injected into the prompt. The agent calls the
 *     semantic-history-search / keyword-history-search skills when it needs them.
 *   - No <memory> block stuffing prior session messages into the system prompt.
 *     Within a Vito session, pi keeps the conversation in its own state across
 *     prompt() calls. After a server restart we start fresh (rehydration is a
 *     future addition).
 *   - System prompt is small + stable: personality, SYSTEM.md, capabilities map,
 *     channel + custom instructions, user profile.
 *   - Datetime + author + channel are prepended to the per-turn user message.
 *   - PiSessionHarness is created once per Vito session and reused across turns,
 *     which is what enables Anthropic prompt caching to hit on every turn.
 *
 * Most channel/command/cron plumbing is intentionally identical to v1 so this
 * can drop in by swapping the import in src/index.ts.
 */

import { CronScheduler } from "../cron/scheduler.js";
import type { Queries } from "../db/queries.js";
import { withPersistence, withRelay, withTracing, withTyping } from "../harnesses/index.js";
import { withNoReplyCheck } from "../harness/decorators/index.js";
import { getDirectChannel, type DirectChannel } from "../channels/direct.js";

import { maybeEmbedNewChunks } from "../memory/embeddings.js";
import { maybeUpdateProfile, setProfileUpdaterConfig, setProfileUpdaterQueries } from "../memory/profile.js";
import { SessionManager } from "../sessions/manager.js";
import { getEffectiveSettings } from "../settings.js";
import { discoverSkills } from "../skills/discovery.js";

import { randomBytes } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";

import type {
  Channel,
  CronJobConfig,
  InboundEvent,
  ResolvedSettings,
  SkillMeta,
  VitoConfig,
} from "../types.js";

import { PiSessionHarness } from "./pi-session-harness.js";
import { buildSystemPromptV2, buildUserMessageV2 } from "./system-prompt.js";

/**
 * Vito session IDs are "channel:target" (e.g., "dashboard:default",
 * "telegram:123456:78"). Percent-encode chars that aren't safe in path
 * components so the encoding is reversible — the dashboard decodes back to
 * the original session id when listing pi-sessions.
 */
function encodeSessionDirName(sessionId: string): string {
  return encodeURIComponent(sessionId);
}

export class OrchestratorV2 {
  private sessionManager: SessionManager;
  private channels = new Map<string, Channel>();
  private cronScheduler: CronScheduler;
  private soul: string;
  private skillsDir: string;

  /** Per-session message queues and processing locks. */
  private sessionQueues = new Map<string, Array<{ event: InboundEvent; channel: Channel | null }>>();
  private sessionProcessing = new Set<string>();

  /** Track active requests so they can be aborted on /stop. */
  private activeRequests = new Map<string, { abort: AbortController; aborted: boolean }>();

  /**
   * Long-lived pi harnesses, keyed by Vito session id.
   * The whole point: same AgentSession reused across turns → cached system prompt.
   */
  private piHarnesses = new Map<string, PiSessionHarness>();

  constructor(
    private queries: Queries,
    private config: VitoConfig,
    soul: string,
    skillsDir: string
  ) {
    this.sessionManager = new SessionManager(queries);
    this.soul = soul;
    this.skillsDir = skillsDir;

    this.cronScheduler = new CronScheduler(
      async (event, channelName) => {
        const channel = channelName ? this.channels.get(channelName) || null : null;
        await this.handleInbound(event, channel);
      },
      async (jobName: string) => {
        await this.removeJobFromConfig(jobName);
      }
    );

    setProfileUpdaterConfig(config);
    setProfileUpdaterQueries(queries);

    const skills = this.getSkills();
    if (skills.length > 0) {
      console.log(
        `[v2] Found ${skills.length} skill(s): ${skills.map((s) => s.name).join(", ")}`
      );
    }
  }

  registerChannel(channel: Channel): void {
    this.channels.set(channel.name, channel);
  }

  getSkills(): SkillMeta[] {
    return discoverSkills(this.skillsDir);
  }

  getCronScheduler() {
    return this.cronScheduler;
  }

  reloadCronJobs(jobs: CronJobConfig[], timezone?: string): void {
    if (timezone) {
      this.cronScheduler.setTimezone(timezone);
    }
    this.cronScheduler.reload(jobs);
  }

  reloadConfig(config: VitoConfig): void {
    this.config = config;
    setProfileUpdaterConfig(config);
    console.log(`[OrchestratorV2] Config reloaded`);
    // Note: hot config reload does NOT automatically rebuild pi sessions. If
    // the user changes their model/profile mid-session, /new is the way to
    // pick up the new system prompt. We could be smarter here later.
  }

  async ask(options: {
    question: string;
    session?: string;
    author?: string;
    channelPrompt?: string;
  }): Promise<string> {
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
      console.error(`[OrchestratorV2.ask] Error: ${err instanceof Error ? err.message : err}`);
      return "I hit a snag trying to think about that. Try asking again.";
    }
  }

  private directChannel: DirectChannel | null = null;
  private directChannelReady: Promise<void> | null = null;

  private getDirectChannel(): DirectChannel {
    if (!this.directChannel) {
      this.directChannel = getDirectChannel();
      this.registerChannel(this.directChannel);
      this.directChannelReady = (async () => {
        await this.directChannel!.start();
        await this.directChannel!.listen((event) => this.handleInbound(event, this.directChannel!));
      })();
    }
    return this.directChannel;
  }

  private async ensureDirectChannelReady(): Promise<void> {
    this.getDirectChannel();
    if (this.directChannelReady) {
      await this.directChannelReady;
    }
  }

  async start(): Promise<void> {
    for (const [name, channel] of this.channels) {
      const channelConfig = this.config.channels[name];
      if (!channelConfig?.enabled) continue;
      try {
        await channel.start();
        await channel.listen((event) => this.handleInbound(event, channel));
        console.log(`[v2] Channel started: ${name}`);
      } catch (err) {
        console.error(`[v2] Channel failed to start: ${name}`, err);
      }
    }
    const timezone = this.config.settings?.timezone;
    this.cronScheduler.start(this.config.cron.jobs, timezone);
  }

  async stop(): Promise<void> {
    this.cronScheduler.stop();
    for (const [, channel] of this.channels) {
      await channel.stop();
    }
    // Tear down all long-lived pi sessions
    for (const [, harness] of this.piHarnesses) {
      await harness.dispose();
    }
    this.piHarnesses.clear();
  }

  // ────────────────────────────────────────────────────────────────────────
  // INBOUND ROUTING (mirrors v1)
  // ────────────────────────────────────────────────────────────────────────

  private async handleInbound(event: InboundEvent, channel: Channel | null): Promise<void> {
    const sessionKey = event.sessionKey;
    console.log(`[v2 handleInbound] ⚡ from ${sessionKey}: "${event.content?.slice(0, 50)}"`);

    if (channel && event.content?.trim() === "/stop") {
      await this.handleStopCommand(event, channel);
      return;
    }
    if (channel && event.content?.trim() === "/restart") {
      await this.handleRestartCommand(event, channel);
      return;
    }

    if (!this.sessionQueues.has(sessionKey)) {
      this.sessionQueues.set(sessionKey, []);
    }
    const queue = this.sessionQueues.get(sessionKey)!;

    queue.push({ event, channel });
    if (this.sessionProcessing.has(sessionKey)) return;

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
        console.error(`[v2] Error processing message for ${sessionKey}:`, err);
        if (channel) {
          const handler = channel.createHandler(event);
          await handler.relay("Sorry, something went wrong processing that message.");
        }
      }
    }

    this.sessionProcessing.delete(sessionKey);
    if (queue && queue.length === 0) {
      this.sessionQueues.delete(sessionKey);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // CORE: processMessage (the v2 simplification)
  // ────────────────────────────────────────────────────────────────────────

  private async processMessage(event: InboundEvent, channel: Channel | null): Promise<void> {
    if (channel && event.content?.trim() === "/stop") {
      await this.handleStopCommand(event, channel);
      return;
    }
    if (channel && event.content?.trim() === "/new") {
      await this.handleNewCommand(event, channel);
      return;
    }

    const vitoSession = this.sessionManager.resolveSession(event.sessionKey);
    await this.downloadAttachments(event);

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

    const effectiveSettings = getEffectiveSettings(this.config, event.channel, event.sessionKey);

    // requireMention — store silently and bail if not addressed.
    const requireMention = effectiveSettings.requireMention !== false;
    const hasMention = event.hasMention !== false;
    if (requireMention && !hasMention) {
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

    console.log(
      `[v2] ${event.sessionKey}: streamMode=${effectiveSettings.streamMode}, model=${this.getModelString(effectiveSettings)}`
    );

    // Start typing immediately so the user sees activity.
    const baseHandler = channel ? channel.createHandler(event) : null;
    if (baseHandler) {
      await baseHandler.startTyping?.();
    }

    try {
      // Output handler + stream mode (same logic as v1)
      const sendCondition = event.raw?.sendCondition as string | null;
      const isDirectChannel = event.raw?.source === "direct-channel";

      let handler = baseHandler;
      let streamMode = effectiveSettings.streamMode;
      if (sendCondition) {
        handler = withNoReplyCheck(baseHandler);
        streamMode = "final";
      } else if (isDirectChannel) {
        streamMode = "final";
      }

      // Get or create the long-lived pi harness for this Vito session.
      const piHarness = this.getOrCreatePiHarness(vitoSession.id, event, effectiveSettings, channel);

      // Per-turn decorator chain wraps the long-lived inner harness.
      const tracedHarness = withTracing(piHarness, {
        session_id: vitoSession.id,
        channel: event.channel,
        target: event.target,
        model: this.getModelString(effectiveSettings),
        traceMessageUpdates: effectiveSettings.traceMessageUpdates ?? false,
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
      const harness = withTyping(relayHarness, handler);

      // Per-turn user message: [datetime, from author, via channel] <content>
      const promptText = buildUserMessageV2({
        content: event.content || "",
        author: event.author,
        channel: event.channel,
        timezone: this.config.settings?.timezone,
        attachmentPaths: event.attachments
          ?.map((a) => a.path)
          .filter((p): p is string => Boolean(p)),
      });

      // System prompt is captured by the pi session ON FIRST RUN ONLY. We pass
      // it on every call (cheap), but the harness ignores it on subsequent runs.
      const systemPrompt = buildSystemPromptV2({
        soul: this.soul,
        channelPrompt: event.raw?.channelPrompt || channel?.getCustomPrompt?.() || "",
        customInstructions: effectiveSettings.customInstructions || "",
        botName: this.config.bot?.name,
        session: {
          id: vitoSession.id,
          channel: event.channel,
          target: event.target,
          alias: vitoSession.alias ?? null,
        },
      });

      // Abort wiring
      const abortController = new AbortController();
      this.activeRequests.set(event.sessionKey, { abort: abortController, aborted: false });

      try {
        await harness.run(
          systemPrompt,
          promptText,
          { onRawEvent: () => {}, onNormalizedEvent: () => {} },
          abortController.signal
        );
      } catch (err) {
        console.error(`[v2] Error during LLM call: ${err instanceof Error ? err.message : err}`);
        return;
      } finally {
        this.activeRequests.delete(event.sessionKey);
      }

      if (channel) {
        this.notifyResponseComplete(channel);
      }

      // Background: chunk + embed; periodic profile update.
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
        console.error(`[v2 Embeddings] Background embedding failed:`, err);
      });

      const currentUserMessage = event.content || "";
      maybeUpdateProfile(vitoSession.id, currentUserMessage).then((profResult) => {
        if (profResult) {
          tracedHarness.writePostRunLine({
            type: "profile_update",
            skipped: profResult.skipped,
            updated: profResult.updated,
            duration_ms: profResult.duration_ms,
            traceFile: profResult.traceFile,
          });
        }
      }).catch((err) => {
        console.error(`[v2 Profile] Background profile update failed:`, err);
      });
    } catch (err) {
      // Safety net: stop typing on any error before/during run setup.
      if (baseHandler) {
        try { await baseHandler.stopTyping?.(); } catch {}
      }
      throw err;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // PI SESSION LIFECYCLE
  // ────────────────────────────────────────────────────────────────────────

  private getOrCreatePiHarness(
    vitoSessionId: string,
    _event: InboundEvent,
    settings: ResolvedSettings,
    _channel: Channel | null
  ): PiSessionHarness {
    let harness = this.piHarnesses.get(vitoSessionId);
    if (!harness) {
      const globalPiConfig = this.config.harnesses?.["pi-coding-agent"];
      const cascadedOverrides = settings["pi-coding-agent"] || {};
      const model = cascadedOverrides.model || globalPiConfig?.model || {
        provider: "anthropic",
        name: "claude-sonnet-4-20250514",
      };
      const thinkingLevel = cascadedOverrides.thinkingLevel || globalPiConfig?.thinkingLevel;

      // Each Vito session gets its own pi sessionDir so JSONL files are
      // grouped per-session and easy to browse from the dashboard.
      const sessionDir = resolve(
        process.cwd(),
        "user/pi-sessions",
        encodeSessionDirName(vitoSessionId),
      );

      harness = new PiSessionHarness({
        model,
        thinkingLevel,
        skillsDir: this.skillsDir,
        sessionDir,
      });
      this.piHarnesses.set(vitoSessionId, harness);
      console.log(`[v2] 🎭 Created long-lived pi session for ${vitoSessionId} (${model.provider}/${model.name}) → ${sessionDir}`);
    }
    return harness;
  }

  private getModelString(settings: ResolvedSettings): string {
    const globalPiConfig = this.config.harnesses?.["pi-coding-agent"];
    const model = settings["pi-coding-agent"]?.model || globalPiConfig?.model || {
      provider: "anthropic",
      name: "claude-sonnet-4-20250514",
    };
    return `${model.provider}/${model.name}`;
  }

  // ────────────────────────────────────────────────────────────────────────
  // COMMANDS
  // ────────────────────────────────────────────────────────────────────────

  private async handleStopCommand(event: InboundEvent, channel: Channel): Promise<void> {
    const sessionKey = `${event.channel}:${event.target}`;
    const handler = channel.createHandler(event);

    const queue = this.sessionQueues.get(sessionKey);
    const queuedCount = queue?.length || 0;
    if (queue) queue.length = 0;

    const active = this.activeRequests.get(sessionKey);
    let aborted = false;
    if (active && !active.aborted) {
      active.aborted = true;
      active.abort.abort();
      aborted = true;
    }

    const wasLocked = this.sessionProcessing.has(sessionKey);
    if (wasLocked) {
      this.sessionProcessing.delete(sessionKey);
    }

    const parts: string[] = [];
    if (aborted) parts.push("⛔ Stopped current request");
    if (queuedCount > 0) parts.push(`🗑️ Cleared ${queuedCount} queued message${queuedCount > 1 ? "s" : ""}`);
    if (wasLocked && !aborted) parts.push("🔓 Released stuck session lock");

    const message = parts.length === 0 ? "✅ Nothing to stop — all clear, boss." : parts.join("\n");
    await handler.relay(message);
    await handler.stopTyping?.();
  }

  private async handleRestartCommand(event: InboundEvent, channel: Channel): Promise<void> {
    const { spawn } = await import("child_process");
    const handler = channel.createHandler(event);
    await handler.relay("🔄 Restarting in 5 seconds...");
    await handler.stopTyping?.();
    const child = spawn("bash", ["-c", "sleep 5 && pm2 restart vito-server"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  /**
   * /new in v2 = manual compaction. Auto-compaction handles the routine case;
   * this command lets the user trigger one on demand without losing continuity.
   * (For a true reset, dispose the session via dashboard or restart.)
   */
  private async handleNewCommand(event: InboundEvent, channel: Channel): Promise<void> {
    const vitoSession = this.sessionManager.resolveSession(event.sessionKey);
    const handler = channel.createHandler(event);

    const existing = this.piHarnesses.get(vitoSession.id);
    if (!existing || !existing.isInitialized()) {
      await handler.relay("✅ Nothing to compact — no active pi session yet.");
      return;
    }

    await handler.startTyping?.();
    try {
      const result = await existing.compact();
      await handler.stopTyping?.();

      // Pi's CompactionResult fields aren't strongly typed at our edge — just
      // surface what's there. Common fields: tokensBefore, tokensAfter, summary.
      let info = "";
      if (result && typeof result === "object") {
        const r = result as Record<string, unknown>;
        const before = typeof r.tokensBefore === "number" ? r.tokensBefore : undefined;
        const after = typeof r.tokensAfter === "number" ? r.tokensAfter : undefined;
        if (before !== undefined && after !== undefined) {
          info = `\n${before.toLocaleString()} → ${after.toLocaleString()} tokens`;
        } else if (before !== undefined) {
          info = `\n${before.toLocaleString()} tokens compacted`;
        }
      }

      await handler.relay(
        `✅ **Compacted.**${info}\n\nOlder turns summarized; recent context kept. Conversation continues. 🧵`
      );
    } catch (err) {
      await handler.stopTyping?.();
      console.error("[v2 /new] compaction failed:", err);
      await handler.relay("❌ Compaction failed — see logs.");
    }
  }

  private notifyResponseComplete(channel: Channel): void {
    if ("reprompt" in channel && typeof (channel as any).reprompt === "function") {
      (channel as any).reprompt();
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // ATTACHMENTS + CONFIG (verbatim from v1)
  // ────────────────────────────────────────────────────────────────────────

  private async removeJobFromConfig(jobName: string): Promise<void> {
    try {
      const configPath = resolve(process.cwd(), "user/vito.config.json");
      const fs = await import("fs/promises");
      const configText = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(configText);
      const originalLength = config.cron.jobs.length;
      config.cron.jobs = config.cron.jobs.filter((job: CronJobConfig) => job.name !== jobName);
      if (config.cron.jobs.length < originalLength) {
        await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
      }
    } catch (err) {
      console.error(`[v2 Config] Failed to remove job ${jobName}:`, err);
    }
  }

  private async downloadAttachments(event: InboundEvent): Promise<void> {
    if (!event.attachments?.length) return;
    const imagesDir = resolve(process.cwd(), "user/drive/images");
    mkdirSync(imagesDir, { recursive: true });

    for (const attachment of event.attachments) {
      if (attachment.path) continue;
      if (!attachment.url) continue;
      try {
        const response = await fetch(attachment.url);
        if (!response.ok) continue;
        const buffer = Buffer.from(await response.arrayBuffer());
        const ext = this.getExtensionForMime(attachment.mimeType || "application/octet-stream");
        const filename = `${Date.now()}_${randomBytes(4).toString("hex")}${ext}`;
        const localPath = join(imagesDir, filename);
        writeFileSync(localPath, buffer);
        attachment.path = localPath;
        attachment.buffer = buffer;
      } catch (err) {
        console.error(`[v2] Error downloading attachment:`, err);
      }
    }
  }

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
}
