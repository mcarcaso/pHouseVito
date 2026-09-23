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
import type {
  AskOptions,
  ContextualPromptOptions,
  OrchestratorRun,
  OrchestratorService,
} from "./OrchestratorService.js";

import { getEffectiveSettings } from "../vito/settings.js";
import {
  xChannelRegistryService,
  xCronService,
  xDb,
  xInboundAttachmentService,
  xDiscordQueueStore,
  xMessageStore,
  xPiSessionStore,
  xPiSessionsDir,
  xProviderService,
  xServerLifecycleService,
  xSessionService,
  xSkillStore,
  xUserDir,
  xVitoService,
} from "../../lib/x.js";

import { randomUUID } from "node:crypto";
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

function eventAbortSignal(event: InboundEvent): AbortSignal | undefined {
  const raw = event.raw;
  if (!raw || typeof raw !== "object" || !("abortSignal" in raw)) return undefined;
  const signal = raw.abortSignal;
  return signal instanceof AbortSignal ? signal : undefined;
}

export class PiOrchestratorService implements OrchestratorService {
  private initialized = false;
  private x!: Context;
  private config!: VitoConfig;

  /** Per-session message queues and processing locks. */
  private sessionQueues = new Map<
    string,
    Array<{
      event: InboundEvent;
      channel: ChannelService | null;
      resolve: () => void;
      reject: (error: unknown) => void;
    }>
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
        signal: options.signal,
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

  async prompt(x: Context, options: ContextualPromptOptions): Promise<string> {
    this.initialize(x);
    await this.ensureDirectChannelReady();
    return this.getDirectChannel().ask({
      question: options.message,
      session: options.session,
      author: options.author ?? "scheduled-job",
      timeoutMs: null,
      signal: options.signal,
      channelPrompt:
        "This is scheduled work in the existing session. Use the session's normal tools, memory, and model. Treat it as a contextual internal trigger, not a new message typed by the user.",
    });
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

  async steer(x: Context, event: InboundEvent): Promise<boolean> {
    this.initialize(x);
    const active = this.activeRequests.get(event.sessionKey);
    if (!active || active.aborted || event.attachments?.length) return false;
    const runtime = this.runtimeRegistry.get(event.sessionKey);
    if (!runtime) return false;
    const promptText = buildUserMessage({
      content: event.content || "",
      author: event.author,
      channel: event.channel,
      timezone: this.config.settings?.timezone,
    });
    const accepted = await runtime.steer(promptText);
    if (!accepted) return false;
    const session = xSessionService(this.x).resolve(this.x, event.sessionKey);
    xMessageStore(this.x).create(this.x, {
      session_id: session.id,
      channel: event.channel,
      channel_target: event.target,
      timestamp: event.timestamp,
      type: "user",
      content: JSON.stringify(event.content || ""),
      archived: 0,
      author: event.author || null,
    });
    return true;
  }

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
    const completion = new Promise<void>((resolveCompletion, rejectCompletion) => {
      queue.push({
        event,
        channel,
        resolve: resolveCompletion,
        reject: rejectCompletion,
      });
    });
    if (!this.sessionProcessing.has(sessionKey)) void this.processSessionQueue(sessionKey);
    await completion;
  }

  private async processSessionQueue(sessionKey: string): Promise<void> {
    this.sessionProcessing.add(sessionKey);
    const queue = this.sessionQueues.get(sessionKey);

    while (queue && queue.length > 0) {
      const {
        event,
        channel,
        resolve: resolveCompletion,
        reject: rejectCompletion,
      } = queue.shift()!;
      try {
        const signal = eventAbortSignal(event);
        if (!signal?.aborted) {
          await this.withSessionLease(sessionKey, signal, () =>
            this.processMessage(event, channel),
          );
        }
        resolveCompletion();
      } catch (err) {
        if (!eventAbortSignal(event)?.aborted) {
          console.error(`[Orchestrator] Error processing message for ${sessionKey}:`, err);
          if (channel) {
            const handler = channel.createOutputHandler(this.x, event);
            await handler.relay("Sorry, something went wrong processing that message.");
            await handler.endMessage?.();
          }
        }
        rejectCompletion(err);
      }
    }

    this.sessionProcessing.delete(sessionKey);
    if (queue && queue.length === 0) {
      this.sessionQueues.delete(sessionKey);
    }
  }

  private async withSessionLease(
    session: string,
    signal: AbortSignal | undefined,
    action: () => Promise<void>,
  ): Promise<void> {
    let db;
    try {
      db = xDb(this.x);
    } catch {
      await action();
      return;
    }

    const owner = randomUUID();
    const leaseMs = 30_000;
    const claim = db.prepare(
      `INSERT INTO session_turn_locks(session, owner, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(session) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
       WHERE session_turn_locks.expires_at <= ?`,
    );
    let acquired = false;
    while (!acquired) {
      if (signal?.aborted) return;
      const now = Date.now();
      acquired = claim.run(session, owner, now + leaseMs, now).changes > 0;
      if (!acquired) await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    if (signal?.aborted) {
      db.prepare("DELETE FROM session_turn_locks WHERE session = ? AND owner = ?").run(
        session,
        owner,
      );
      return;
    }

    const renew = setInterval(() => {
      try {
        db.prepare(
          "UPDATE session_turn_locks SET expires_at = ? WHERE session = ? AND owner = ?",
        ).run(Date.now() + leaseMs, session, owner);
      } catch (error) {
        console.warn(
          `[Orchestrator] Could not renew session lease for ${session}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }, 10_000);
    renew.unref();
    try {
      await action();
    } finally {
      clearInterval(renew);
      db.prepare("DELETE FROM session_turn_locks WHERE session = ? AND owner = ?").run(
        session,
        owner,
      );
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // CORE: processMessage
  // ────────────────────────────────────────────────────────────────────────

  private async processMessage(event: InboundEvent, channel: ChannelService | null): Promise<void> {
    const externalSignal = eventAbortSignal(event);
    if (externalSignal?.aborted) return;
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
    if (channel && /^\/session(?:\s|$)/i.test(commandText)) {
      await this.handleSessionCommand(commandEvent, channel);
      return;
    }
    if (channel && /^\/login(?:\s|$)/i.test(commandText)) {
      await this.handleLoginCommand(commandEvent, channel);
      return;
    }
    if (channel && commandText === "/status") {
      await this.handleStatusCommand(commandEvent, channel);
      return;
    }
    if (channel && commandText === "/help") {
      await this.handleHelpCommand(commandEvent, channel);
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
      if (event.channel === "discord" && streamMode !== "final") {
        promptText = [
          "<delivery_instruction>",
          "During multi-step tool work, send concise public commentary before meaningful tool groups and when your direction changes. Commentary is not private reasoning and is separate from the final answer.",
          "</delivery_instruction>",
          "",
          promptText,
        ].join("\n");
      }

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
      const abortFromExternal = () => abortController.abort();
      externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
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
        if (!abortController.signal.aborted) throw err;
        return;
      } finally {
        externalSignal?.removeEventListener("abort", abortFromExternal);
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
    const queued = queue?.splice(0) ?? [];
    const metadata = parseInboundEventMetadata(event.raw);
    const queuedCount = queued.length + (metadata.discordDiscarded ?? 0);
    for (const pending of queued) pending.reject(new Error("Request cleared by /stop"));

    const active = this.activeRequests.get(sessionKey);
    let aborted = false;
    if (active && !active.aborted) {
      active.aborted = true;
      active.abort.abort();
      aborted = true;
    }

    const wasLocked = this.sessionProcessing.has(sessionKey);

    const parts: string[] = [];
    if (aborted) parts.push("⛔ Stopped current request");
    if (queuedCount > 0)
      parts.push(`🗑️ Cleared ${queuedCount} queued message${queuedCount > 1 ? "s" : ""}`);
    if (wasLocked && !aborted) parts.push("⏳ Session worker is finishing its current cleanup");

    const message = parts.length === 0 ? "✅ Nothing to stop — all clear, boss." : parts.join("\n");
    await handler.relay(message);
    await handler.stopTyping?.();
  }

  private async handleRestartCommand(event: InboundEvent, channel: ChannelService): Promise<void> {
    const handler = channel.createOutputHandler(this.x, event);
    if (
      event.channel === "discord" &&
      parseInboundEventMetadata(event.raw).commandAuthorized !== true
    ) {
      await handler.relay("Only the bot owner can restart Vito.");
      await handler.endMessage?.();
      return;
    }
    await handler.relay("🔄 Rebuilding dashboard and restarting...");
    await handler.stopTyping?.();
    xServerLifecycleService(this.x).requestRestart(this.x, {
      userAgent: `slash-command/${event.channel}`,
    });
  }

  private async handleStatusCommand(event: InboundEvent, channel: ChannelService): Promise<void> {
    const handler = channel.createOutputHandler(this.x, event);
    const session = xSessionService(this.x).resolve(this.x, event.sessionKey);
    const effective = getEffectiveSettings(this.config, event.channel, event.sessionKey);
    const model =
      this.runtimeRegistry.get(session.id)?.getModel() ?? this.getModelString(effective);
    const queue = this.sessionQueues.get(event.sessionKey)?.length ?? 0;
    let durable = "";
    if (event.channel === "discord") {
      const counts = xDiscordQueueStore(this.x).counts(this.x);
      durable = `\nDiscord queue: ${counts.pending} pending, ${counts.active} active, ${counts.interrupted} interrupted`;
    }
    await handler.relay(
      `Session: \`${session.id}\`\nModel: \`${model}\`\nState: ${this.activeRequests.has(event.sessionKey) ? "busy" : "idle"}\nQueued here: ${queue}${durable}`,
    );
    await handler.endMessage?.();
  }

  private async handleHelpCommand(event: InboundEvent, channel: ChannelService): Promise<void> {
    const handler = channel.createOutputHandler(this.x, event);
    await handler.relay(
      [
        "`/new` — archive chat and start a fresh Pi session",
        "`/session [id]` — list or resume this conversation's Pi sessions",
        "`/compact` — summarize older context",
        "`/model [provider/model]` — inspect or switch this session's model",
        "`/login [provider]` — start private provider authorization",
        "`/stop` — cancel active work and clear queued invocations",
        "`/status` — session, model, and durable queue state",
        "`/restart` — owner-only Vito service restart; never reboots the host",
        "`/help` — this help",
      ].join("\n"),
    );
    await handler.endMessage?.();
  }

  private async handleLoginCommand(event: InboundEvent, channel: ChannelService): Promise<void> {
    const handler = channel.createOutputHandler(this.x, event);
    const provider = (event.content || "").replace(/^\/login\b/i, "").trim() || "openai-codex";
    try {
      const result = await xProviderService(this.x).startLogin(this.x, provider);
      if (result.status === "already_authenticated") {
        await handler.relay(`\`${provider}\` is already authenticated.`);
      } else if (result.status === "device_code_started") {
        await handler.relay(
          `Open **${result.verificationUri}** and enter code **${result.userCode}**.\nThe code expires in ${Math.ceil((result.expiresInSeconds ?? 900) / 60)} minutes. Use \`/status\` after authorization.`,
        );
      } else {
        await handler.relay(
          `Open **${result.url}** to authorize \`${provider}\`.${result.instructions ? `\n${result.instructions}` : ""}`,
        );
      }
    } catch (error) {
      await handler.relay(
        `Login could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await handler.endMessage?.();
  }

  private async handleSessionCommand(event: InboundEvent, channel: ChannelService): Promise<void> {
    const handler = channel.createOutputHandler(this.x, event);
    const vitoSession = xSessionService(this.x).resolve(this.x, event.sessionKey);
    const selectedId = (event.content || "").replace(/^\/session\b/i, "").trim();
    const sessions = xPiSessionStore(this.x).list(this.x, {
      vitoSessionIds: [vitoSession.id],
      order: "recent",
      limit: 20,
    });
    if (!selectedId) {
      const lines = sessions.map(
        (session, index) =>
          `${index === 0 ? "Current/recent" : "Previous"}: \`${session.id}\` · ${new Date(session.updatedAt).toISOString()}`,
      );
      await handler.relay(
        lines.length
          ? `${lines.join("\n")}\nUse \`/session <exact ID>\` to resume.`
          : "No persisted Pi sessions exist for this conversation yet.",
      );
      await handler.endMessage?.();
      return;
    }
    const selected = sessions.find((session) => session.id === selectedId);
    if (!selected) {
      await handler.relay("That session does not belong to this Discord conversation.");
      await handler.endMessage?.();
      return;
    }
    const path = resolve(xPiSessionsDir(this.x), selected.id);
    await this.runtimeRegistry.resume(
      this.x,
      vitoSession.id,
      getEffectiveSettings(this.config, event.channel, event.sessionKey),
      path,
    );
    this.firstTurnDone.add(vitoSession.id);
    await handler.relay(`Resumed Pi session \`${selected.id}\`.`);
    await handler.endMessage?.();
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
      const vitoService = xVitoService(this.x);
      const config = vitoService.getConfig(this.x);
      const currentSession = config.sessions?.[vitoSession.id] ?? {};
      config.sessions = {
        ...config.sessions,
        [vitoSession.id]: {
          ...currentSession,
          "pi-coding-agent": {
            ...(currentSession["pi-coding-agent"] ?? {}),
            model,
          },
        },
      };
      vitoService.saveConfig(this.x, config);
      this.config = config;
      await handler.relay(
        `✅ Session model: \`${currentModel}\` → \`${model.provider}/${model.name}\`.\n\nThis persists for this conversation; channel and global defaults are unchanged.`,
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
