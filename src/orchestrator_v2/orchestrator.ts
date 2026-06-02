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
import { loadConfig } from "../config.js";
import type { Queries } from "../db/queries.js";
import {
  createHarness,
  HarnessUnsupportedError,
  HarnessSessionLostError,
  withPersistence,
  withRelay,
  withTracing,
  withTyping,
  type Harness,
  type HarnessName,
} from "../harnesses/index.js";
import { withNoReplyCheck } from "../harness/decorators/index.js";
import { getDirectChannel, type DirectChannel } from "../channels/direct.js";

import { maybeEmbedNewChunks } from "../memory/embeddings.js";
import { SessionManager } from "../sessions/manager.js";
import { getEffectiveSettings } from "../settings.js";
import { discoverSkills } from "../skills/discovery.js";

import { randomBytes } from "crypto";
import { mkdirSync, statSync, writeFileSync } from "fs";
import { join, resolve } from "path";

import { extractMessageText } from "../memory/context.js";

import type {
  Channel,
  CronJobConfig,
  InboundEvent,
  ResolvedSettings,
  SkillMeta,
  VitoConfig,
} from "../types.js";

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

function normalizeSlashCommand(content?: string): string {
  return (content || "").trim().replace(/^\/([A-Za-z0-9_]+)@[^\s]+(?=\s|$)/, "/$1");
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
   * Long-lived harnesses, keyed by Vito session id. Same harness instance
   * reused across turns — that's what enables Anthropic prompt caching to
   * hit on every turn.
   */
  private harnesses = new Map<string, Harness>();

  /**
   * Tracks which harness type (e.g., "pi-coding-agent", "claude-code") each
   * live harness instance is. Used on config reload to detect a harness-type
   * switch and tear down the old instance so the next turn rebuilds with the
   * right implementation — without this, `setModel` would blindly stamp a
   * pi model name onto a still-claude-code harness (or vice versa).
   */
  private harnessNames = new Map<string, HarnessName>();

  /**
   * Vito session ids whose harness has produced at least one completed turn.
   * Used to decide whether to seed the next prompt with a <history> block:
   *   - First turn for a brand-new harness instance → maybe seed
   *   - Any subsequent turn → never seed (state lives in the harness)
   * Cleared on /new alongside harness reset.
   */
  private firstTurnDone = new Set<string>();

  /** Last observed mtime for user/vito.config.json. Used as a lazy fallback
   * in case the fs watcher debounce hasn't fired before the next message. */
  private configMtimeMs = 0;

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

    this.configMtimeMs = this.getConfigMtimeMs();

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
    this.configMtimeMs = this.getConfigMtimeMs();
    console.log(`[OrchestratorV2] Config reloaded`);
    // No push-sync to live harnesses — getOrCreateHarness reconciles lazily
    // on the next message for each session that drifted.
  }

  async ask(options: {
    question: string;
    session?: string;
    author?: string;
    channelPrompt?: string;
    timeoutMs?: number | null;
  }): Promise<string> {
    await this.ensureDirectChannelReady();
    const directChannel = this.getDirectChannel();
    try {
      const response = await directChannel.ask({
        question: options.question,
        session: options.session,
        author: options.author,
        channelPrompt: options.channelPrompt,
        timeoutMs: options.timeoutMs,
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

  private getConfigMtimeMs(): number {
    try {
      return statSync(resolve(process.cwd(), "user/vito.config.json")).mtimeMs;
    } catch {
      return 0;
    }
  }

  private reloadConfigIfChanged(): void {
    const latestMtime = this.getConfigMtimeMs();
    if (!latestMtime || latestMtime <= this.configMtimeMs) return;

    try {
      const newConfig = loadConfig();
      this.config = newConfig;
      this.configMtimeMs = latestMtime;
      console.log(`[OrchestratorV2] Lazily reloaded config before message`);
    } catch (err) {
      console.error(`[OrchestratorV2] Lazy config reload failed:`, err);
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
    // Tear down all long-lived harness sessions
    for (const [, harness] of this.harnesses) {
      try { await harness.dispose?.(); } catch { /* ignore */ }
    }
    this.harnesses.clear();
    this.harnessNames.clear();
    this.firstTurnDone.clear();
  }

  // ────────────────────────────────────────────────────────────────────────
  // INBOUND ROUTING (mirrors v1)
  // ────────────────────────────────────────────────────────────────────────

  private async handleInbound(event: InboundEvent, channel: Channel | null): Promise<void> {
    const sessionKey = event.sessionKey;
    console.log(`[v2 handleInbound] ⚡ from ${sessionKey}: "${event.content?.slice(0, 50)}"`);

    const commandText = normalizeSlashCommand(event.content);
    const commandEvent = commandText !== (event.content || "").trim() ? { ...event, content: commandText } : event;

    if (channel && commandText === "/stop") {
      await this.handleStopCommand(commandEvent, channel);
      return;
    }
    if (channel && commandText === "/restart") {
      await this.handleRestartCommand(commandEvent, channel);
      return;
    }
    // /new and /compact are non-priority — they go through the queue so they
    // don't race with an in-flight turn. Routing happens in processMessage.

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
    this.reloadConfigIfChanged();

    const commandText = normalizeSlashCommand(event.content);
    const commandEvent = commandText !== (event.content || "").trim() ? { ...event, content: commandText } : event;

    if (channel && commandText === "/stop") {
      await this.handleStopCommand(commandEvent, channel);
      return;
    }
    if (channel && commandText === "/new") {
      await this.handleNewCommand(commandEvent, channel);
      return;
    }
    if (channel && commandText === "/compact") {
      await this.handleCompactCommand(commandEvent, channel);
      return;
    }
    if (channel && /^\/model(?:\s|$)/i.test(commandText)) {
      await this.handleModelCommand(commandEvent, channel);
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

      // Get or create the long-lived harness for this Vito session.
      const innerHarness = await this.getOrCreateHarness(vitoSession.id, event, effectiveSettings, channel);
      const actualModelString = innerHarness.getModel?.() ?? this.getModelString(effectiveSettings);

      // Per-turn decorator chain wraps the long-lived inner harness.
      const tracedHarness = withTracing(innerHarness, {
        session_id: vitoSession.id,
        channel: event.channel,
        target: event.target,
        model: actualModelString,
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
      let promptText = buildUserMessageV2({
        content: event.content || "",
        author: event.author,
        channel: event.channel,
        timezone: this.config.settings?.timezone,
        attachmentPaths: event.attachments
          ?.map((a) => a.path)
          .filter((p): p is string => Boolean(p)),
      });

      // If this run is going to create a BRAND-NEW pi AgentSession, seed
      // the first prompt with the tail of this Vito session's SQLite history.
      // This covers both:
      //   - /new: .fresh marker forces PiSessionManager.create()
      //   - first v2 run for an existing Vito session: no pi JSONL exists yet
      // We DON'T seed on restart-resume when a pi JSONL exists, because pi
      // already has the conversation in its own state and this would duplicate.
      // Seed history on the first prompt of a brand-new harness session,
      // regardless of which harness is in use. The harness reports whether
      // the next run() will start fresh; if it has resumable state we skip
      // seeding to avoid duplicating context the harness already has.
      const willCreateBrandNewSession = !this.firstTurnDone.has(vitoSession.id)
        && (innerHarness.isFresh?.() ?? false);
      if (willCreateBrandNewSession) {
        const historyBlock = this.buildHistoryBlock(vitoSession.id, 10);
        if (historyBlock) {
          promptText = `${historyBlock}\n\n${promptText}`;
          console.log(`[v2] Seeded new harness session for ${vitoSession.id} with history (${historyBlock.length} chars)`);
        }
      }

      // System prompt is captured by the harness ON FIRST RUN ONLY. We pass
      // it on every call (cheap), but the harness ignores it on subsequent runs.
      const systemPrompt = buildSystemPromptV2({
        soul: this.soul,
        channelPrompt: event.raw?.channelPrompt || channel?.getCustomPrompt?.() || "",
        customInstructions: effectiveSettings.customInstructions || "",
        harnessInstructions: innerHarness.getCustomInstructions?.() || "",
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
        this.firstTurnDone.add(vitoSession.id);
      } catch (err) {
        if (err instanceof HarnessSessionLostError) {
          // Underlying session storage is gone. Drop the harness so the next
          // /new (or fresh start) recreates cleanly, and tell the user.
          this.harnesses.delete(vitoSession.id);
          this.harnessNames.delete(vitoSession.id);
          this.firstTurnDone.delete(vitoSession.id);
          if (baseHandler) {
            await baseHandler.relay(
              "⚠️ Your harness session is no longer available (the underlying conversation file is gone). Run `/new` to start a fresh one."
            );
          }
          console.warn(`[v2] HarnessSessionLost for ${event.sessionKey}: ${err.message}`);
          return;
        }
        console.error(`[v2] Error during LLM call: ${err instanceof Error ? err.message : err}`);
        return;
      } finally {
        this.activeRequests.delete(event.sessionKey);
      }

      if (channel) {
        this.notifyResponseComplete(channel);
      }

      // Background: chunk + embed; periodic profile update.
      const contextualizerModel = effectiveSettings.memory?.chunkContextualizerModel?.name;
      maybeEmbedNewChunks(vitoSession.id, { contextualizerModel }).then((embResult) => {
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

  /**
   * Lazy reconciliation: every per-message call resolves the desired harness
   * type + model from current settings, then compares against the live
   * instance. Type drift → dispose and rebuild. Model drift → hot-swap via
   * setModel. No drift → return the cached instance untouched (the prompt
   * cache stays warm).
   */
  private async getOrCreateHarness(
    vitoSessionId: string,
    _event: InboundEvent,
    settings: ResolvedSettings,
    _channel: Channel | null
  ): Promise<Harness> {
    const harnessName = this.resolveHarnessName(settings);
    const globalPiConfig = this.config.harnesses?.["pi-coding-agent"];
    const piOverrides = settings["pi-coding-agent"] || {};
    const globalCcConfig = this.config.harnesses?.["claude-code"];
    const ccOverrides = settings["claude-code"] || {};

    const model = (harnessName === "claude-code"
      ? ccOverrides.model || globalCcConfig?.model
      : piOverrides.model || globalPiConfig?.model)
      || { provider: "anthropic", name: "claude-sonnet-4-20250514" };

    const existing = this.harnesses.get(vitoSessionId);
    if (existing) {
      const existingName = this.harnessNames.get(vitoSessionId);
      if (existingName === harnessName) {
        const desiredString = `${model.provider}/${model.name}`;
        if (existing.getModel?.() !== desiredString && existing.setModel) {
          try {
            await existing.setModel(model);
            console.log(`[v2] Hot-swapped model for ${vitoSessionId} → ${desiredString}`);
          } catch (err) {
            console.error(`[v2] Failed to hot-swap model for ${vitoSessionId}:`, err);
          }
        }
        return existing;
      }

      // Harness type changed (e.g., pi-coding-agent ⇄ claude-code). Dispose
      // the old instance — its on-disk JSONL stays for history — then fall
      // through to build a fresh harness of the desired type.
      try { await existing.dispose?.(); } catch { /* ignore */ }
      this.harnesses.delete(vitoSessionId);
      this.harnessNames.delete(vitoSessionId);
      this.firstTurnDone.delete(vitoSessionId);
      console.log(`[v2] Harness type changed for ${vitoSessionId}: ${existingName} → ${harnessName}; rebuilding`);
    }

    const thinkingLevel = piOverrides.thinkingLevel || globalPiConfig?.thinkingLevel;
    const permissionMode = ccOverrides.permissionMode || globalCcConfig?.permissionMode;
    const binaryPath = ccOverrides.binaryPath || globalCcConfig?.binaryPath;

    // Each Vito session gets its own sessionDir so on-disk artifacts are
    // grouped per-session and easy to browse from the dashboard.
    const sessionDir = this.getSessionDir(vitoSessionId, harnessName);

    const harness = createHarness(harnessName, {
      sessionDir,
      model,
      thinkingLevel,
      skillsDir: this.skillsDir,
      permissionMode,
      binaryPath,
    });
    this.harnesses.set(vitoSessionId, harness);
    this.harnessNames.set(vitoSessionId, harnessName);
    console.log(`[v2] 🎭 Created long-lived ${harnessName} session for ${vitoSessionId} (${model.provider}/${model.name}) → ${sessionDir}`);
    return harness;
  }

  private resolveHarnessName(settings: ResolvedSettings): HarnessName {
    const name = settings.harness ?? "pi-coding-agent";
    if (name === "pi-coding-agent" || name === "claude-code") return name;
    console.warn(`[v2] Unknown harness "${name}", falling back to pi-coding-agent`);
    return "pi-coding-agent";
  }

  /**
   * Filesystem path for a Vito session's harness on-disk state. Each harness
   * implementation owns its subdirectory layout — pi writes pi.jsonl files
   * directly into this dir, claude-code writes a session.json pointer.
   */
  private getSessionDir(vitoSessionId: string, harnessName: HarnessName = "pi-coding-agent"): string {
    const subdir = harnessName === "claude-code" ? "cc-sessions" : "pi-sessions";
    return resolve(process.cwd(), "user", subdir, encodeSessionDirName(vitoSessionId));
  }

  /**
   * Format the last N messages from a Vito session as a <history> block,
   * to be prepended to the first user message of a fresh pi session.
   *
   * Returns null if there are no messages to include. We pull including
   * archived because /new archives messages immediately, so the messages
   * we want to seed with are flagged archived by the time we get here.
   * Skips thoughts and tool messages — only conversational user/assistant
   * turns are useful as context.
   */
  private buildHistoryBlock(vitoSessionId: string, limit: number): string | null {
    const recent = this.queries.getRecentMessages(
      vitoSessionId,
      limit,
      false, // includeTools
      false, // includeThoughts
      true,  // includeArchived — /new archives the messages we want to seed from
    );
    if (recent.length === 0) return null;

    const lines: string[] = [];
    for (const msg of recent) {
      let text: string;
      try {
        text = extractMessageText(msg.content);
      } catch {
        continue;
      }
      if (!text) continue;
      const speaker = msg.type === "user"
        ? (typeof msg.author === "string" && msg.author ? msg.author : "user")
        : "assistant";
      lines.push(`${speaker}: ${text}`);
    }

    if (lines.length === 0) return null;

    return [
      "<history>",
      "These are the last messages from before /new — provided as context only. Treat as background; the user's actual new message follows below.",
      "",
      lines.join("\n\n"),
      "</history>",
    ].join("\n");
  }

  private getModelString(settings: ResolvedSettings): string {
    const harnessName = this.resolveHarnessName(settings);
    const model = harnessName === "claude-code"
      ? settings["claude-code"]?.model || this.config.harnesses?.["claude-code"]?.model
      : settings["pi-coding-agent"]?.model || this.config.harnesses?.["pi-coding-agent"]?.model;
    const fallback = { provider: "anthropic", name: "claude-sonnet-4-20250514" };
    const m = model ?? fallback;
    return `${m.provider}/${m.name}`;
  }

  private parseModelSpec(spec: string, fallbackProvider = "anthropic"): { provider: string; name: string } | null {
    const trimmed = spec.trim();
    if (!trimmed) return null;

    const slash = trimmed.indexOf("/");
    if (slash > 0) {
      const provider = trimmed.slice(0, slash).trim();
      const name = trimmed.slice(slash + 1).trim();
      if (provider && name) return { provider, name };
      return null;
    }

    return { provider: fallbackProvider, name: trimmed };
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
    await handler.relay("🔄 Rebuilding dashboard and restarting...");
    await handler.stopTyping?.();
    // Mirror the dashboard restart button: rebuild the React bundle, then
    // pm2 restart. `;` (not `&&`) so a failed build still restarts the
    // backend — matches the dashboard endpoint's try/catch behavior.
    const child = spawn("bash", ["-c", "sleep 2; npm run build:dashboard; pm2 restart vito-server"], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  /**
   * /new = full reset. Disposes the live pi session, drops a `.fresh` marker
   * so the next message creates a brand-new pi session (which also picks up
   * any system-prompt changes — SOUL.md, profile, custom instructions, etc.),
   * and archives SQLite messages so the dashboard chat view also clears.
   *
   * Old pi JSONL files are left in place; they show up as historical
   * sessions in the Pi Sessions dashboard page.
   */
  private async handleNewCommand(event: InboundEvent, channel: Channel): Promise<void> {
    const vitoSession = this.sessionManager.resolveSession(event.sessionKey);
    const handler = channel.createHandler(event);

    const existing = this.harnesses.get(vitoSession.id);
    const recentMessages = this.queries.getRecentMessages(vitoSession.id, 1);
    if (!existing && recentMessages.length === 0) {
      await handler.relay("✅ Already starting fresh! Nothing to reset.");
      await handler.stopTyping?.();
      return;
    }

    await handler.startTyping?.();
    try {
      // The fast, deterministic part of /new: archive + reset harness session.
      // Force-embedding can take minutes to hours on long sessions
      // (thousands of API calls), so we kick it off in the background
      // instead of blocking the user. New harness session creation doesn't
      // depend on embeddings finishing — it just starts fresh.
      if (recentMessages.length > 0) {
        this.queries.markSessionArchived(vitoSession.id);
      }

      // Reset must happen unconditionally so the next message starts fresh,
      // even if no in-memory harness exists right now (e.g., /new fired after
      // a server restart, before any message rehydrated the harness). We
      // construct a transient harness to call reset() — its constructor is
      // cheap and reset() handles the "no live session yet" path.
      const harnessForReset = existing ?? await this.getOrCreateHarness(
        vitoSession.id,
        event,
        getEffectiveSettings(this.config, event.channel, event.sessionKey),
        channel
      );
      await harnessForReset.reset?.();
      this.harnesses.delete(vitoSession.id);
      this.harnessNames.delete(vitoSession.id);
      this.firstTurnDone.delete(vitoSession.id);

      await handler.relay(
        `✅ **Fresh start!**\n\nHarness session reset, messages archived. Next message starts a new session with the current system prompt.\n\nForce-embedding archived messages in the background — they'll be searchable via memory skills once it finishes. 🚀`
      );
      // stopTyping AFTER relay so the buffer actually flushes (the Discord
      // handler buffers relay() and only flushes on stopTyping/endMessage).
      // For slash commands this is what calls editReply on the deferred
      // interaction; without it the user sees "Vito is thinking..." forever.
      await handler.stopTyping?.();

      // Background force-embed. Errors logged, not surfaced to the user.
      const newSettings = getEffectiveSettings(this.config, event.channel, event.sessionKey);
      const contextualizerModel = newSettings.memory?.chunkContextualizerModel?.name;
      maybeEmbedNewChunks(vitoSession.id, { force: true, contextualizerModel })
        .then((embResult) => {
          if (embResult?.skipped) {
            console.log(`[v2 /new] background embed skipped: ${embResult.skipped}`);
          } else {
            console.log(`[v2 /new] background embed complete — ${embResult?.chunks_created ?? 0} chunk(s) for ${vitoSession.id}`);
          }
        })
        .catch((err) => {
          console.error(`[v2 /new] background embed failed for ${vitoSession.id}:`, err);
        });
    } catch (err) {
      console.error("[v2 /new] reset failed:", err);
      await handler.relay("❌ Reset failed — see logs.");
      await handler.stopTyping?.();
    }
  }

  /**
   * /model [provider/name] = switch the live long-lived pi session's model
   * without starting a new conversation. If there's no active pi session yet,
   * the harness config is updated so the next turn starts on that model.
   */
  private async handleModelCommand(event: InboundEvent, channel: Channel): Promise<void> {
    const vitoSession = this.sessionManager.resolveSession(event.sessionKey);
    const handler = channel.createHandler(event);
    const raw = event.content?.trim() || "";
    const spec = raw.replace(/^\/model\b/i, "").trim();
    const effectiveSettings = getEffectiveSettings(this.config, event.channel, event.sessionKey);
    const currentModel = this.harnesses.get(vitoSession.id)?.getModel?.() || this.getModelString(effectiveSettings);

    if (!spec) {
      await handler.relay(
        `Current model: \`${currentModel}\`\n\nUse \`/model provider/model-name\`, e.g. \`/model anthropic/claude-sonnet-4-20250514\` or \`/model openrouter/deepseek/deepseek-v4-pro\`.`
      );
      await handler.stopTyping?.();
      return;
    }

    const fallbackProvider = currentModel.includes("/") ? currentModel.slice(0, currentModel.indexOf("/")) : "anthropic";
    const model = this.parseModelSpec(spec, fallbackProvider);
    if (!model) {
      await handler.relay("Couldn't parse that model, boss. Use `/model provider/model-name`.");
      await handler.stopTyping?.();
      return;
    }

    await handler.startTyping?.();
    try {
      const innerHarness = await this.getOrCreateHarness(vitoSession.id, event, effectiveSettings, channel);
      if (!innerHarness.setModel) {
        await handler.relay(`❌ This harness does not support hot-swapping the model.`);
        await handler.stopTyping?.();
        return;
      }
      await innerHarness.setModel(model);
      await handler.relay(
        `✅ Switched live model: \`${currentModel}\` → \`${model.provider}/${model.name}\`\n\nNo /new needed. This is a runtime session change; config stays untouched.`
      );
      await handler.stopTyping?.();
    } catch (err) {
      console.error("[v2 /model] failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      await handler.relay(`❌ Model switch failed: ${message}`);
      await handler.stopTyping?.();
    }
  }

  /**
   * /compact = manual compaction of the live pi session. Pi summarizes older
   * turns and keeps the recent ones, so the conversation continues from
   * where it was — just with a shorter prefix. Auto-compaction handles the
   * routine case; this is the on-demand trigger.
   */
  private async handleCompactCommand(event: InboundEvent, channel: Channel): Promise<void> {
    const vitoSession = this.sessionManager.resolveSession(event.sessionKey);
    const handler = channel.createHandler(event);

    const existing = this.harnesses.get(vitoSession.id);
    if (!existing || !this.firstTurnDone.has(vitoSession.id)) {
      await handler.relay("✅ Nothing to compact — no active session yet.");
      await handler.stopTyping?.();
      return;
    }
    if (!existing.compact) {
      await handler.relay("❌ This harness does not support manual compaction.");
      await handler.stopTyping?.();
      return;
    }

    await handler.startTyping?.();
    try {
      const result = await existing.compact();

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
      // stopTyping after relay so the buffer flushes (see /new for details).
      await handler.stopTyping?.();
    } catch (err) {
      if (err instanceof HarnessUnsupportedError) {
        await handler.relay("❌ This harness does not support manual compaction.");
        await handler.stopTyping?.();
        return;
      }
      console.error("[v2 /compact] failed:", err);
      await handler.relay("❌ Compaction failed — see logs.");
      await handler.stopTyping?.();
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
