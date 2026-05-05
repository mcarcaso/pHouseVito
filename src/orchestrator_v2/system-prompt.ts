/**
 * System prompt builder for orchestrator v2.
 *
 * Goal: keep the system prompt small, stable, and deterministic so it can be
 * cached. Anything volatile (datetime, the user's message text, attachments)
 * goes into the per-turn user message instead.
 *
 * What's IN the v2 system prompt:
 *   - Personality (SOUL.md)
 *   - System rules (SYSTEM.md, via buildSystemBlock)
 *   - Channel-specific instructions
 *   - Custom instructions (from settings cascade)
 *   - User profile (profile.md) — kept inline because it's small and only changes
 *     when the user explicitly resets or via periodic background updates
 *   - A short "capabilities map" pointing at tools/skills the agent can use
 *
 * What's OUT (compared to v1):
 *   - Per-turn datetime (moved to user message)
 *   - Skill listings (pi-coding-agent already exposes the Skill tool)
 *   - Auto-recalled memories (agent calls the recall skill on demand instead)
 *   - <memory> with current/cross-session messages (pi keeps current-session
 *     history in its AgentSession; cross-session is opt-in via skills)
 *   - Harness instructions (we control the harness, no quirks to document)
 */

import { loadProfileForPrompt } from "../memory/profile.js";
import { buildSystemBlock } from "../system-instructions.js";
import { CAPABILITIES_MAP } from "./capabilities.js";

export interface BuildSystemPromptV2Options {
  soul: string;
  channelPrompt?: string;
  customInstructions?: string;
  botName?: string;
  /** Stable identifiers for the Vito session this pi conversation lives inside. */
  session?: {
    id: string;       // e.g., "dashboard:default" or "telegram:123:456"
    channel: string;  // e.g., "dashboard"
    target: string;   // e.g., "default"
    alias?: string | null;
  };
}

export function buildSystemPromptV2(opts: BuildSystemPromptV2Options): string {
  const parts: string[] = [];

  if (opts.soul) {
    parts.push(`<personality>\n${opts.soul}\n</personality>`);
  }

  // SYSTEM.md + commands
  parts.push(buildSystemBlock(true, opts.botName));

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

  // User profile is small and stable enough to inline. Periodic updates will
  // invalidate the cache when they happen, but that's acceptable — the win
  // is on the many turns between profile updates.
  const profilePrompt = loadProfileForPrompt();
  if (profilePrompt) {
    parts.push(`<user-profile>\n${profilePrompt}\n</user-profile>`);
  }

  return parts.join("\n\n");
}

/**
 * Build the per-turn user message. Datetime + author + channel context are
 * prepended so the system prompt stays stable.
 */
export interface BuildUserMessageV2Options {
  content: string;
  author?: string;
  channel?: string;
  timezone?: string;
  attachmentPaths?: string[];
}

export function buildUserMessageV2(opts: BuildUserMessageV2Options): string {
  const tz = opts.timezone || "America/Toronto";
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
