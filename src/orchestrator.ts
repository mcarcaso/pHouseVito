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
import type {
  VitoConfig,
  InboundEvent,
  Channel,
  OutboundMessage,
  StreamMode,
  SkillMeta,
} from "./types.js";
import type { CLIChannel } from "./channels/cli.js";
import { resolve } from "path";

const MEDIA_REGEX = /MEDIA:(\/[^\s]+)/g;

interface ActiveSession {
  piSession: AgentSession;
  vitoSessionId: string;
}

export class Orchestrator {
  private activeSessions = new Map<string, ActiveSession>();
  private sessionManager: SessionManager;
  private channels = new Map<string, Channel>();
  private soul: string;
  private skills: SkillMeta[];
  private isProcessing = false;
  private messageQueue: Array<{
    event: InboundEvent;
    channel: Channel;
  }> = [];

  constructor(
    private queries: Queries,
    private config: VitoConfig,
    soul: string,
    skillsDir: string
  ) {
    this.sessionManager = new SessionManager(queries);
    this.soul = soul;
    this.skills = discoverSkills(skillsDir);

    if (this.skills.length > 0) {
      console.log(
        `Loaded ${this.skills.length} skill(s): ${this.skills.map((s) => s.name).join(", ")}`
      );
    }
  }

  /** Register a channel with the orchestrator */
  registerChannel(channel: Channel): void {
    this.channels.set(channel.name, channel);
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
  }

  /** Stop all channels */
  async stop(): Promise<void> {
    for (const [, channel] of this.channels) {
      await channel.stop();
    }
    // Dispose all pi sessions
    for (const [, active] of this.activeSessions) {
      active.piSession.dispose();
    }
    this.activeSessions.clear();
  }

  /** Handle an inbound message from any channel */
  private async handleInbound(
    event: InboundEvent,
    channel: Channel
  ): Promise<void> {
    // Queue message — process one at a time for v1
    this.messageQueue.push({ event, channel });
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
        const handler = channel.createHandler(event);
        await handler.relay({
          text: "Sorry, something went wrong processing that message.",
        });
      }
    }
    this.isProcessing = false;
  }

  private async processMessage(
    event: InboundEvent,
    channel: Channel
  ): Promise<void> {
    // 1. Resolve/create Vito session
    const vitoSession = this.sessionManager.resolveSession(
      event.channel,
      event.target
    );

    // 2. Store the user message in our DB
    this.queries.insertMessage({
      session_id: vitoSession.id,
      channel: event.channel,
      channel_target: event.target,
      timestamp: event.timestamp,
      role: "user",
      content: JSON.stringify(event.content),
      compacted: 0,
    });

    // 3. Get or create pi session
    const active = await this.getOrCreatePiSession(vitoSession.id);

    // 4. Build fresh context and update system prompt
    const ctx = await assembleContext(
      this.queries,
      vitoSession.id,
      this.config
    );
    const contextPrompt = formatContextForPrompt(ctx);
    const skillsPrompt = formatSkillsForPrompt(this.skills);

    // Update the resource loader's append prompt to include our context
    // Then reload to rebuild the system prompt
    active.piSession.agent.state.systemPrompt = this.buildSystemPrompt(
      contextPrompt,
      skillsPrompt,
      channel.getCustomPrompt?.() || ""
    );

    // 5. Set up output handler
    const handler = channel.createHandler(event);
    const streamMode = this.getStreamMode(event.channel);

    // Start typing indicator if supported
    if (channel.capabilities.typing) {
      await handler.startTyping?.();
    }

    // 6. Collect response
    let fullText = "";
    const unsubscribe = active.piSession.subscribe(
      (agentEvent: AgentSessionEvent) => {
        if (agentEvent.type === "message_update") {
          const msgEvent = agentEvent.assistantMessageEvent;
          if (msgEvent.type === "text_delta") {
            fullText += msgEvent.delta;
            if (streamMode === "stream") {
              handler.relay({ text: msgEvent.delta }).catch(() => {});
            }
          }
        }
      }
    );

    try {
      // 7. Send prompt to pi
      await active.piSession.prompt(event.content);
    } finally {
      unsubscribe();
      if (channel.capabilities.typing) {
        await handler.stopTyping?.();
      }
    }

    // 8. Relay final/bundled response
    if (streamMode !== "stream" && fullText) {
      // Parse MEDIA: references
      const { text, attachments } = parseMediaReferences(fullText);
      await handler.relay({ text, attachments });
    }

    // 9. Store the assistant response in our DB
    if (fullText) {
      this.queries.insertMessage({
        session_id: vitoSession.id,
        channel: event.channel,
        channel_target: event.target,
        timestamp: Date.now(),
        role: "assistant",
        content: JSON.stringify(fullText),
        compacted: 0,
      });
    }

    // 10. Signal the channel that the response is complete (for re-prompting)
    this.notifyResponseComplete(channel);

    // 11. Check if compaction is needed (run in background)
    if (shouldCompact(this.queries, this.config)) {
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
        .then(() => console.log("Compaction complete."))
        .catch((err) => console.error("Compaction failed:", err));
    }
  }

  private notifyResponseComplete(channel: Channel): void {
    // CLI channel needs to re-prompt after response
    if ("reprompt" in channel && typeof (channel as any).reprompt === "function") {
      (channel as CLIChannel).reprompt();
    }
  }

  private async getOrCreatePiSession(
    vitoSessionId: string
  ): Promise<ActiveSession> {
    const existing = this.activeSessions.get(vitoSessionId);
    if (existing) return existing;

    // Build initial context
    const ctx = await assembleContext(
      this.queries,
      vitoSessionId,
      this.config
    );
    const contextPrompt = formatContextForPrompt(ctx);
    const skillsPrompt = formatSkillsForPrompt(this.skills);

    const systemPrompt = this.buildSystemPrompt(contextPrompt, skillsPrompt, "");

    const resourceLoader = new DefaultResourceLoader({
      cwd: process.cwd(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt: systemPrompt,
    });
    await resourceLoader.reload();

    const { session: piSession } = await createAgentSession({
      sessionManager: PiSessionManager.inMemory(),
      model: this.getModel(),
      resourceLoader,
      thinkingLevel: "off",
    });

    const active: ActiveSession = { piSession, vitoSessionId };
    this.activeSessions.set(vitoSessionId, active);
    return active;
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

  private getStreamMode(channelName: string): StreamMode {
    return this.config.channels[channelName]?.streamMode || "final";
  }

  private getModel() {
    const { provider, name } = this.config.model;
    return getModel(provider as any, name as any);
  }
}

/** Parse MEDIA:/path references from LLM output */
function parseMediaReferences(text: string): {
  text: string;
  attachments?: OutboundMessage["attachments"];
} {
  const attachments: NonNullable<OutboundMessage["attachments"]> = [];
  const cleaned = text.replace(MEDIA_REGEX, (_, path) => {
    attachments.push({
      type: "file",
      path: path,
    });
    return "";
  });

  return {
    text: cleaned.trim(),
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}
