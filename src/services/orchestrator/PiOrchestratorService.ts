/**
 * Process-lifetime application service coordinating channels, queues, cron,
 * commands, and one persisted PiSessionRuntime per Vito session.
 */

import { parseInboundEventMetadata } from "../../lib/types/inbound-event.js";
import type { Context } from "../../context/Context.js";
import { withPersistence } from "./runtime/PersistencePiRuntime.js";
import { withRelay } from "./runtime/RelayPiRuntime.js";
import { withTracing } from "./runtime/TracingPiRuntime.js";
import { withTyping } from "./runtime/TypingPiRuntime.js";
import { NoReplyOutputHandler } from "../../lib/output/NoReplyOutputHandler.js";
import { DirectChannelService } from "../channels/direct/DirectChannelService.js";
import type { ChannelService } from "../channels/ChannelService.js";
import type { AskOptions, OrchestratorRun, OrchestratorService } from "./OrchestratorService.js";

import { getEffectiveSettings } from "../vito/settings.js";
import {
  xChannelRegistryService,
  xCronService,
  xInboundAttachmentService,
  xMessageStore,
  xServerLifecycleService,
  xSessionService,
  xSkillStore,
  xUserDir,
  xVitoService,
} from "../../lib/x.js";

import { statSync } from "node:fs";
import { resolve } from "node:path";

import { extractMessageText } from "../memory/message-content.js";

import type { InboundEvent } from "../../lib/types/inbound-event.js";
import type {
  CronJobConfig,
  ResolvedSettings,
  VitoConfig,
} from "../../shared/schemas/vito-config.js";

import { PiRuntimeRegistry } from "./PiRuntimeRegistry.js";
import { buildSystemPrompt, buildUserMessage } from "./system-prompt.js";

function normalizeSlashCommand(content?: string): string {
  return (content || "").trim().replace(/^\/([A-Za-z0-9_]+)@[^\s]+(?=\s|$)/, "/$1");
}

export class PiOrchestratorService implements OrchestratorService {
  private initialized = false;
  private x!: Context;
  private config!: VitoConfig;

  /** Per-session message queues and processing locks. */
  private sessionQueues = new Map<
    string,
    Array<{ event: InboundEvent; channel: ChannelService | null }>
  >();
  private sessionProcessing = new Set<string>();

  /** Track active requests so they can be aborted on /stop. */
  private activeRequests = new Map<
    string,
    { abort: AbortController; aborted: boolean; event: InboundEvent; startedAt: number }
  >();

  /**
   * Long-lived runtimes, keyed by Vito session id. Same runtime instance
   * reused across turns — that's what enables Anthropic prompt caching to
   * hit on every turn.
   */
  private readonly runtimeRegistry = new PiRuntimeRegistry();

  /**
   * Vito session ids whose runtime has produced at least one completed turn.
   * Used to decide whether to seed the next prompt with a <history> block:
   *   - First turn for a brand-new runtime instance → maybe seed
   *   - Any subsequent turn → never seed (state lives in the runtime)
   * Cleared on /new alongside runtime reset.
   */
  private firstTurnDone = new Set<string>();

  /** Last observed mtime for user/vito.config.json. Used as a lazy fallback
   * in case the fs watcher debounce hasn't fired before the next message. */
  private configMtimeMs = 0;

  private initialize(x: Context): void {
    if (this.initialized) return;

    this.x = x;
    this.config = xVitoService(x).getConfig(x);
    this.configMtimeMs = this.getConfigMtimeMs();

    const skills = this.getSkills();
    if (skills.length > 0) {
      console.log(
        `[Orchestrator] Found ${skills.length} skill(s): ${skills.map((s) => s.name).join(", ")}`,
      );
    }
    this.initialized = true;
  }

  registerChannel(x: Context, channel: ChannelService, channelX?: Context): void {
    this.initialize(x);
    xChannelRegistryService(x).register(channelX ?? x, channel);
  }

  private getSkills() {
    return xSkillStore(this.x).list(this.x, {});
  }

  reloadCronJobs(x: Context, jobs: CronJobConfig[], timezone?: string): void {
    this.initialize(x);
    xCronService(x).reload(x, jobs, timezone);
  }

  reloadConfig(x: Context, config: VitoConfig): void {
    this.initialize(x);
    this.config = config;
    this.configMtimeMs = this.getConfigMtimeMs();
    console.log(`[PiOrchestratorService] Config reloaded`);
    // No push-sync to live runtimes — PiRuntimeRegistry reconciles lazily
    // on the next message for each session that drifted.
  }

  async ask(x: Context, options: AskOptions): Promise<string> {
    this.initialize(x);
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
      const answer = response || "I couldn't come up with an answer for that one.";
      if (options.relayToSession && options.session) {
        await this.relayDirectAnswerToSession(options.session, answer, options.author);
      }
      return answer;
    } catch (err) {
      console.error(
        `[PiOrchestratorService.ask] Error: ${err instanceof Error ? err.message : err}`,
      );
      return "I hit a snag trying to think about that. Try asking again.";
    }
  }

  async appendSessionContext(
    x: Context,
    sessionId: string,
    content: string,
    details: { key: string; source: string },
  ): Promise<void> {
    this.initialize(x);
    this.reloadConfigIfChanged();
    const session = xSessionService(this.x).resolve(this.x, sessionId);
    const channelName = session.channel || sessionId.split(":")[0] || "dashboard";
    const effectiveSettings = getEffectiveSettings(this.config, channelName, sessionId);
    const innerRuntime = await this.runtimeRegistry.getOrCreate(
      this.x,
      sessionId,
      effectiveSettings,
    );
    const shouldSeedHistory = !this.firstTurnDone.has(sessionId) && innerRuntime.isFresh();
    const channel = xChannelRegistryService(this.x).get(this.x, channelName)?.channel;
    const vitoService = xVitoService(this.x);
    const systemPrompt = buildSystemPrompt({
      soul: vitoService.getSoul(this.x),
      systemInstructions: vitoService.getSystemPrompt(this.x),
      channelPrompt: channel?.getCustomPrompt?.(this.x) || "",
      customInstructions: effectiveSettings.customInstructions || "",
      botName: this.config.bot?.name,
      session: {
        id: session.id,
        channel: channelName,
        target: session.channel_target || sessionId.split(":").slice(1).join(":"),
        alias: session.alias ?? null,
      },
    });
    const historyBlock = shouldSeedHistory ? this.buildHistoryBlock(sessionId, 10) : null;
    await innerRuntime.appendContext(
      systemPrompt,
      historyBlock ? `${historyBlock}\n\n${content}` : content,
      details,
    );
  }

  private async relayDirectAnswerToSession(
    session: string,
    answer: string,
    author?: string,
  ): Promise<void> {
    const sessionParts = session.split(":");
    const channelName = sessionParts[0] || "api";
    const target = sessionParts.slice(1).join(":") || "default";
    const channel = xChannelRegistryService(this.x).get(this.x, channelName)?.channel;
    if (!channel || channelName === "direct" || channelName === "api") return;

    const event: InboundEvent = {
      sessionKey: `${channelName}:${target}`,
      channel: channelName,
      target,
      author: author || "api",
      timestamp: Date.now(),
      content: "",
      hasMention: true,
      raw: { synthetic: true, source: "direct-channel-relay" },
    };

    try {
      const handler = channel.createOutputHandler(this.x, event);
      await handler.relay(answer);
      await handler.endMessage?.();
    } catch (err) {
      console.error(`[PiOrchestratorService.ask] Failed to relay answer to ${session}:`, err);
    }
  }

  private directChannel: DirectChannelService | null = null;
  private directChannelReady: Promise<void> | null = null;

  private getDirectChannel(): DirectChannelService {
    if (!this.directChannel) {
      const directChannel = new DirectChannelService();
      this.directChannel = directChannel;
      this.registerChannel(this.x, directChannel);
      this.directChannelReady = (async () => {
        await directChannel.start(this.x);
        await directChannel.listen(this.x, (event) =>
          this.handleInbound(this.x, event, directChannel),
        );
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
      return statSync(resolve(xUserDir(this.x), "vito.config.json")).mtimeMs;
    } catch {
      return 0;
    }
  }

  private reloadConfigIfChanged(): void {
    const latestMtime = this.getConfigMtimeMs();
    if (!latestMtime || latestMtime <= this.configMtimeMs) return;

    try {
      const newConfig = xVitoService(this.x).getConfig(this.x);
      this.config = newConfig;
      this.configMtimeMs = latestMtime;
      console.log(`[PiOrchestratorService] Lazily reloaded config before message`);
    } catch (err) {
      console.error(`[PiOrchestratorService] Lazy config reload failed:`, err);
    }
  }

  listRuns(_x: Context): OrchestratorRun[] {
    const runs: OrchestratorRun[] = [];
    for (const [sessionKey, active] of this.activeRequests) {
      runs.push({
        sessionKey,
        channel: active.event.channel,
        author: active.event.author,
        preview: active.event.content.slice(0, 180),
        status: "active",
        timestamp: active.startedAt,
      });
    }
    for (const [sessionKey, queue] of this.sessionQueues) {
      for (const item of queue) {
        runs.push({
          sessionKey,
          channel: item.event.channel,
          author: item.event.author,
          preview: item.event.content.slice(0, 180),
          status: "queued",
          timestamp: item.event.timestamp,
        });
      }
    }
    return runs.sort((a, b) => a.timestamp - b.timestamp);
  }

  async start(x: Context): Promise<void> {
    this.initialize(x);
    for (const { channel, x: channelX } of xChannelRegistryService(x).list(x)) {
      const channelConfig = this.config.channels[channel.name];
      if (!channelConfig?.enabled) continue;
      try {
        await channel.start(channelX);
        await channel.listen(channelX, (event) => this.handleInbound(this.x, event, channel));
        console.log(`[Orchestrator] Channel started: ${channel.name}`);
      } catch (err) {
        console.error(`[Orchestrator] Channel failed to start: ${channel.name}`, err);
      }
    }
    xCronService(x).start(x, {
      jobs: this.config.cron.jobs,
      timezone: this.config.settings?.timezone,
      onJob: async (event, channelName) => {
        const channel = channelName
          ? (xChannelRegistryService(this.x).get(this.x, channelName)?.channel ?? null)
          : null;
        await this.handleInbound(this.x, event, channel);
      },
      onJobComplete: async (jobName) => {
        await this.removeJobFromConfig(jobName);
      },
    });
  }

  async stop(x: Context): Promise<void> {
    this.initialize(x);
    xCronService(x).stop(x);
    for (const { channel, x } of xChannelRegistryService(this.x).list(this.x)) {
      await channel.stop(x);
    }
    await this.runtimeRegistry.disposeAll();
    this.firstTurnDone.clear();
  }

  // ────────────────────────────────────────────────────────────────────────
  // INBOUND ROUTING (mirrors v1)
  // ────────────────────────────────────────────────────────────────────────

  async handleInbound(
    x: Context,
    event: InboundEvent,
    channel: ChannelService | null,
  ): Promise<void> {
    this.initialize(x);
    const sessionKey = event.sessionKey;
    console.log(`[Orchestrator] ⚡ from ${sessionKey}: "${event.content?.slice(0, 50)}"`);

    const commandText = normalizeSlashCommand(event.content);
    const commandEvent =
      commandText !== (event.content || "").trim() ? { ...event, content: commandText } : event;

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
        console.error(`[Orchestrator] Error processing message for ${sessionKey}:`, err);
        if (channel) {
          const handler = channel.createOutputHandler(this.x, event);
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
  // CORE: processMessage
  // ────────────────────────────────────────────────────────────────────────

  private async processMessage(event: InboundEvent, channel: ChannelService | null): Promise<void> {
    this.reloadConfigIfChanged();

    const commandText = normalizeSlashCommand(event.content);
    const commandEvent =
      commandText !== (event.content || "").trim() ? { ...event, content: commandText } : event;

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

    const vitoSession = xSessionService(this.x).resolve(this.x, event.sessionKey);
    await xInboundAttachmentService(this.x).prepare(this.x, event);

    const userContent = event.attachments?.length
      ? {
          text: event.content,
          attachments: event.attachments.map((a) => ({
            type: a.type,
            path: a.path,
            url: a.url,
            filename: a.filename,
            mimeType: a.mimeType,
          })),
        }
      : event.content;

    const effectiveSettings = getEffectiveSettings(this.config, event.channel, event.sessionKey);

    // requireMention — ignore unaddressed chatter. Mention-aware channels can
    // fetch a small platform-native context window when Vito is addressed.
    const requireMention = effectiveSettings.requireMention !== false;
    const hasMention = event.hasMention !== false;
    if (requireMention && !hasMention) return;

    console.log(
      `[Orchestrator] ${event.sessionKey}: streamMode=${effectiveSettings.streamMode}, model=${this.getModelString(effectiveSettings)}`,
    );

    // Start typing immediately so the user sees activity.
    const baseHandler = channel ? channel.createOutputHandler(this.x, event) : null;
    if (baseHandler) {
      await baseHandler.startTyping?.();
    }

    try {
      // Output handler + stream mode (same logic as v1)
      const rawMetadata = parseInboundEventMetadata(event.raw);
      const sendCondition = rawMetadata.sendCondition ?? null;
      const isDirectChannel = rawMetadata.source === "direct-channel";

      let handler = baseHandler;
      let streamMode = effectiveSettings.streamMode;
      if (sendCondition && baseHandler) {
        handler = new NoReplyOutputHandler(baseHandler);
        streamMode = "final";
      } else if (isDirectChannel) {
        streamMode = "final";
      }

      // Get or create the long-lived runtime for this Vito session.
      const innerRuntime = await this.runtimeRegistry.getOrCreate(
        this.x,
        vitoSession.id,
        effectiveSettings,
      );
      const actualModelString = innerRuntime.getModel();

      // Per-turn decorator chain wraps the long-lived inner runtime.
      const tracedRuntime = withTracing(innerRuntime, {
        x: this.x,
        session_id: vitoSession.id,
        channel: event.channel,
        target: event.target,
        model: actualModelString,
        traceMessageUpdates: effectiveSettings.traceMessageUpdates ?? false,
      });

      const persistedRuntime = withPersistence(tracedRuntime, {
        x: this.x,
        sessionId: vitoSession.id,
        channel: event.channel,
        target: event.target,
        userContent,
        userTimestamp: event.timestamp,
        author: event.author,
      });
      const relayRuntime = withRelay(persistedRuntime, { handler, streamMode });
      const runtime = withTyping(relayRuntime, handler);

      // Per-turn user message: [datetime, from author, via channel] <content>
      let promptText = buildUserMessage({
        content: event.content || "",
        author: event.author,
        channel: event.channel,
        timezone: this.config.settings?.timezone,
        attachmentPaths: event.attachments
          ?.map((a) => a.path)
          .filter((p): p is string => Boolean(p)),
      });

      if (requireMention && hasMention && channel?.gatherMentionContext) {
        try {
          const mentionContext = await channel.gatherMentionContext(this.x, event);
          if (mentionContext) promptText = `${mentionContext}\n\n${promptText}`;
        } catch (err) {
          console.warn(
            `[Orchestrator] Failed to gather mention context for ${event.sessionKey}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // If this run is going to create a BRAND-NEW pi AgentSession, seed
      // the first prompt with the tail of this Vito session's SQLite history.
      // This covers both:
      //   - /new: .fresh marker forces PiSessionManager.create()
      //   - first Pi runtime run for an existing Vito session: no pi JSONL exists yet
      // We DON'T seed on restart-resume when a pi JSONL exists, because pi
      // already has the conversation in its own state and this would duplicate.
      // Seed history on the first prompt of a brand-new runtime session,
      // regardless of which runtime is in use. The runtime reports whether
      // the next run() will start fresh; if it has resumable state we skip
      // seeding to avoid duplicating context the runtime already has.
      const willCreateBrandNewSession =
        !this.firstTurnDone.has(vitoSession.id) && innerRuntime.isFresh();
      if (willCreateBrandNewSession) {
        const historyBlock = this.buildHistoryBlock(vitoSession.id, 10);
        if (historyBlock) {
          promptText = `${historyBlock}\n\n${promptText}`;
          console.log(
            `[Orchestrator] Seeded new runtime session for ${vitoSession.id} with history (${historyBlock.length} chars)`,
          );
        }
      }

      // System prompt is captured by the runtime ON FIRST RUN ONLY. We pass
      // it on every call (cheap), but the runtime ignores it on subsequent runs.
      const vitoService = xVitoService(this.x);
      const systemPrompt = buildSystemPrompt({
        soul: vitoService.getSoul(this.x),
        systemInstructions: vitoService.getSystemPrompt(this.x),
        channelPrompt: rawMetadata.channelPrompt || channel?.getCustomPrompt?.(this.x) || "",
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
      this.activeRequests.set(event.sessionKey, {
        abort: abortController,
        aborted: false,
        event,
        startedAt: Date.now(),
      });

      try {
        await runtime.run(
          systemPrompt,
          promptText,
          { onRawEvent: () => {}, onNormalizedEvent: () => {} },
          abortController.signal,
        );
        this.firstTurnDone.add(vitoSession.id);
      } catch (err) {
        console.error(
          `[Orchestrator] Error during LLM call: ${err instanceof Error ? err.message : err}`,
        );
        return;
      } finally {
        this.activeRequests.delete(event.sessionKey);
      }
    } catch (err) {
      // Safety net: stop typing on any error before/during run setup.
      if (baseHandler) {
        try {
          await baseHandler.stopTyping?.();
        } catch {}
      }
      throw err;
    }
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
    const recent = xMessageStore(this.x)
      .list(this.x, {
        sessionIds: [vitoSessionId],
        limit,
        excludeTypes: ["thought", "tool_start", "tool_end"],
        order: "newest",
        orderBy: "timestamp",
        // Include both archived and active messages: /new archives the history
        // before the next fresh session is created.
      })
      .reverse();
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
      const speaker =
        msg.type === "user"
          ? typeof msg.author === "string" && msg.author
            ? msg.author
            : "user"
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
    const model = settings["pi-coding-agent"]?.model;
    const fallback = { provider: "anthropic", name: "claude-sonnet-4-20250514" };
    const m = model ?? fallback;
    return `${m.provider}/${m.name}`;
  }

  private parseModelSpec(
    spec: string,
    fallbackProvider = "anthropic",
  ): { provider: string; name: string } | null {
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

  private async handleStopCommand(event: InboundEvent, channel: ChannelService): Promise<void> {
    const sessionKey = event.sessionKey;
    const handler = channel.createOutputHandler(this.x, event);

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
    if (queuedCount > 0)
      parts.push(`🗑️ Cleared ${queuedCount} queued message${queuedCount > 1 ? "s" : ""}`);
    if (wasLocked && !aborted) parts.push("🔓 Released stuck session lock");

    const message = parts.length === 0 ? "✅ Nothing to stop — all clear, boss." : parts.join("\n");
    await handler.relay(message);
    await handler.stopTyping?.();
  }

  private async handleRestartCommand(event: InboundEvent, channel: ChannelService): Promise<void> {
    const handler = channel.createOutputHandler(this.x, event);
    await handler.relay("🔄 Rebuilding dashboard and restarting...");
    await handler.stopTyping?.();
    xServerLifecycleService(this.x).requestRestart(this.x, {
      userAgent: `slash-command/${event.channel}`,
    });
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
  private async handleNewCommand(event: InboundEvent, channel: ChannelService): Promise<void> {
    const vitoSession = xSessionService(this.x).resolve(this.x, event.sessionKey);
    const handler = channel.createOutputHandler(this.x, event);

    const existing = this.runtimeRegistry.get(vitoSession.id);
    const recentMessages = xMessageStore(this.x).list(this.x, {
      sessionIds: [vitoSession.id],
      archived: false,
      limit: 1,
      order: "newest",
    });
    if (!existing && recentMessages.length === 0) {
      await handler.relay("✅ Already starting fresh! Nothing to reset.");
      await handler.stopTyping?.();
      return;
    }

    await handler.startTyping?.();
    try {
      // The fast, deterministic part of /new: archive + reset runtime session.
      // Force-embedding can take minutes to hours on long sessions
      // (thousands of API calls), so we kick it off in the background
      // instead of blocking the user. New runtime session creation doesn't
      // depend on embeddings finishing — it just starts fresh.
      if (recentMessages.length > 0) {
        xMessageStore(this.x).cmd(this.x, {
          type: "archive-sessions",
          sessionIds: [vitoSession.id],
        });
      }

      // Reset must happen unconditionally so the next message starts fresh,
      // even if no in-memory runtime exists right now (e.g., /new fired after
      // a server restart, before any message rehydrated the runtime). We
      // construct a transient runtime to call reset() — its constructor is
      // cheap and reset() handles the "no live session yet" path.
      const runtimeForReset =
        existing ??
        (await this.runtimeRegistry.getOrCreate(
          this.x,
          vitoSession.id,
          getEffectiveSettings(this.config, event.channel, event.sessionKey),
        ));
      await runtimeForReset.reset();
      this.runtimeRegistry.delete(vitoSession.id);
      this.firstTurnDone.delete(vitoSession.id);

      await handler.relay(
        `✅ **Fresh start!**\n\nPi session reset, messages archived. Next message starts a new session with the current system prompt.\n\nForce-embedding archived messages in the background — they'll be searchable via memory skills once it finishes. 🚀`,
      );
      // stopTyping AFTER relay so the buffer actually flushes (the Discord
      // handler buffers relay() and only flushes on stopTyping/endMessage).
      // For slash commands this is what calls editReply on the deferred
      // interaction; without it the user sees "Vito is thinking..." forever.
      await handler.stopTyping?.();
    } catch (err) {
      console.error("[/new] reset failed:", err);
      await handler.relay("❌ Reset failed — see logs.");
      await handler.stopTyping?.();
    }
  }

  /**
   * /model [provider/name] = switch the live long-lived pi session's model
   * without starting a new conversation. If there's no active pi session yet,
   * the runtime config is updated so the next turn starts on that model.
   */
  private async handleModelCommand(event: InboundEvent, channel: ChannelService): Promise<void> {
    const vitoSession = xSessionService(this.x).resolve(this.x, event.sessionKey);
    const handler = channel.createOutputHandler(this.x, event);
    const raw = event.content?.trim() || "";
    const spec = raw.replace(/^\/model\b/i, "").trim();
    const effectiveSettings = getEffectiveSettings(this.config, event.channel, event.sessionKey);
    const currentModel =
      this.runtimeRegistry.get(vitoSession.id)?.getModel() ||
      this.getModelString(effectiveSettings);

    if (!spec) {
      await handler.relay(
        `Current model: \`${currentModel}\`\n\nUse \`/model provider/model-name\`, e.g. \`/model anthropic/claude-sonnet-4-20250514\` or \`/model openrouter/deepseek/deepseek-v4-pro\`.`,
      );
      await handler.stopTyping?.();
      return;
    }

    const fallbackProvider = currentModel.includes("/")
      ? currentModel.slice(0, currentModel.indexOf("/"))
      : "anthropic";
    const model = this.parseModelSpec(spec, fallbackProvider);
    if (!model) {
      await handler.relay("Couldn't parse that model, boss. Use `/model provider/model-name`.");
      await handler.stopTyping?.();
      return;
    }

    await handler.startTyping?.();
    try {
      const innerRuntime = await this.runtimeRegistry.getOrCreate(
        this.x,
        vitoSession.id,
        effectiveSettings,
      );
      await innerRuntime.setModel(model);
      await handler.relay(
        `✅ Switched live model: \`${currentModel}\` → \`${model.provider}/${model.name}\`\n\nNo /new needed. This is a runtime session change; config stays untouched.`,
      );
      await handler.stopTyping?.();
    } catch (err) {
      console.error("[/model] failed:", err);
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
  private async handleCompactCommand(event: InboundEvent, channel: ChannelService): Promise<void> {
    const vitoSession = xSessionService(this.x).resolve(this.x, event.sessionKey);
    const handler = channel.createOutputHandler(this.x, event);

    const existing = this.runtimeRegistry.get(vitoSession.id);
    if (!existing || !this.firstTurnDone.has(vitoSession.id)) {
      await handler.relay("✅ Nothing to compact — no active session yet.");
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
        `✅ **Compacted.**${info}\n\nOlder turns summarized; recent context kept. Conversation continues. 🧵`,
      );
      // stopTyping after relay so the buffer flushes (see /new for details).
      await handler.stopTyping?.();
    } catch (err) {
      console.error("[/compact] failed:", err);
      await handler.relay("❌ Compaction failed — see logs.");
      await handler.stopTyping?.();
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // ATTACHMENTS + CONFIG (verbatim from v1)
  // ────────────────────────────────────────────────────────────────────────

  private async removeJobFromConfig(jobName: string): Promise<void> {
    try {
      const vitoService = xVitoService(this.x);
      const config = vitoService.getConfig(this.x);
      const originalLength = config.cron.jobs.length;
      config.cron.jobs = config.cron.jobs.filter((job: CronJobConfig) => job.name !== jobName);
      if (config.cron.jobs.length < originalLength) {
        vitoService.saveConfig(this.x, config);
      }
    } catch (err) {
      console.error(`[Config] Failed to remove job ${jobName}:`, err);
    }
  }
}
