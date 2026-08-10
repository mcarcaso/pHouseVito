/**
 * System prompt builder for orchestrator service.
 *
 * Goal: keep the system prompt small, stable, and deterministic so it can be
 * cached. Anything volatile (datetime, the user's message text, attachments)
 * goes into the per-turn user message instead.
 *
 * What's IN the system prompt:
 *   - Personality (SOUL.md)
 *   - System rules (SYSTEM.md, via buildSystemBlock)
 *   - Channel-specific instructions
 *   - Custom instructions (from settings cascade)
 *   - A short "capabilities map" pointing at tools/skills/files the agent can use
 *
 * What's OUT (compared to v1):
 *   - Per-turn datetime (moved to user message)
 *   - Skill listings (pi-coding-agent already exposes the Skill tool)
 *   - Auto-recalled memories (agent calls the recall skill on demand instead)
 *   - <memory> with current/cross-session messages (pi keeps current-session
 *     history in its AgentSession; cross-session is opt-in via skills)
 *   - PiRuntime instructions (we control the runtime, no quirks to document)
 *   - User profile — pi sessions live for days/weeks, but profile.md is updated
 *     by a background process every turn. Inlining it would freeze a stale
 *     snapshot in the cached system prompt. Instead, the capabilities map
 *     tells the agent to Read user/profile.md on first response in a session.
 */

import { DEFAULT_TIMEZONE } from "../../shared/defaults.js";
import { CAPABILITIES_MAP } from "./capabilities.js";

const COMMANDS_SECTION =
  "Available commands: /new (full reset — start a fresh pi session, archives the current chat), /compact (summarize older turns to free context, conversation continues), /model [provider/model] (inspect or switch the live pi model for this session), /stop (abort current request + clear queue)";

function buildSystemBlock(systemInstructions: string, botName?: string): string {
  const parts: string[] = [];
  if (botName) {
    parts.push(`Your name is ${botName}.`);
    parts.push(
      `If the user message is only your name (e.g., "@${botName}"), interpret it as a follow-up to the previous user message.`,
    );
  }
  parts.push(systemInstructions || "(SYSTEM.md not found — operating without system reference)");
  parts.push(COMMANDS_SECTION);
  return `<system>\n${parts.join("\n\n")}\n</system>`;
}

export interface BuildSystemPromptOptions {
  soul: string;
  systemInstructions: string;
  channelPrompt?: string;
  customInstructions?: string;
  botName?: string;
  /** Stable identifiers for the Vito session this pi conversation lives inside. */
  session?: {
    id: string; // e.g., "dashboard:default" or "telegram:123:456"
    channel: string; // e.g., "dashboard"
    target: string; // e.g., "default"
    alias?: string | null;
  };
}

export function buildSystemPrompt(opts: BuildSystemPromptOptions): string {
  const parts: string[] = [];

  if (opts.soul) {
    parts.push(`<personality>\n${opts.soul}\n</personality>`);
  }

  // SYSTEM.md + commands
  parts.push(buildSystemBlock(opts.systemInstructions, opts.botName));

  // Stable session identity. Doesn't change for the lifetime of this pi
  // session, so it caches with the rest of the prefix. Useful when memory
  // skills need to scope queries by session_id, or when channels need to
  // route per-target actions.
  if (opts.session) {
    const lines = [
      `Session ID: ${opts.session.id}`,
      `Channel: ${opts.session.channel}`,
      `Target: ${opts.session.target}`,
    ];
    if (opts.session.alias) {
      lines.push(`Alias: ${opts.session.alias}`);
    }
    parts.push(`<session>\n${lines.join("\n")}\n</session>`);
  }

  // Capability map: short pointers to tools/skills/files
  parts.push(`<capabilities>\n${CAPABILITIES_MAP}\n</capabilities>`);

  if (opts.channelPrompt) {
    parts.push(`<channel>\n${opts.channelPrompt}\n</channel>`);
  }

  if (opts.customInstructions) {
    parts.push(`<custom-instructions>\n${opts.customInstructions}\n</custom-instructions>`);
  }

  return parts.join("\n\n");
}

/**
 * Build the per-turn user message. Datetime + author + channel context are
 * prepended so the system prompt stays stable.
 */
export interface BuildUserMessageOptions {
  content: string;
  author?: string;
  channel?: string;
  timezone?: string;
  attachmentPaths?: string[];
}

export function buildUserMessage(opts: BuildUserMessageOptions): string {
  const tz = opts.timezone || DEFAULT_TIMEZONE;
  const now = new Date();
  const dateStr = now.toLocaleString("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const headerBits: string[] = [dateStr];
  if (opts.author) headerBits.push(`from ${opts.author}`);
  if (opts.channel) headerBits.push(`via ${opts.channel}`);
  const header = `[${headerBits.join(", ")}]`;

  const lines: string[] = [`${header} ${opts.content || ""}`.trim()];

  if (opts.attachmentPaths?.length) {
    lines.push("");
    lines.push("Attachments:");
    for (const p of opts.attachmentPaths) {
      lines.push(`- ${p}`);
    }
  }

  return lines.join("\n");
}
