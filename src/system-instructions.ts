/**
 * System instructions loader.
 * 
 * All operational rules and reference material live in SYSTEM.md (hot-reloaded).
 * This file just reads it and wraps it in <system> tags for the prompt.
 */

import { readFileSync } from "fs";
import { join } from "path";

const COMMANDS_SECTION = `Available commands: /new (compact this session — summarizes older turns, keeps recent context), /stop (abort current request + clear queue)`;

/** Default timezone — used when config doesn't specify one */
export const DEFAULT_TIMEZONE = "America/Toronto";

/**
 * Build the <system> block by reading SYSTEM.md.
 */
export function buildSystemBlock(includeCommands: boolean = true, botName?: string): string {
  const parts: string[] = [];
  if (botName) {
    parts.push(`Your name is ${botName}.`);
    parts.push(`If the user message is only your name (e.g., "@${botName}"), interpret it as a follow-up to the previous user message.`);
  }

  // Read SYSTEM.md — the single source of truth
  try {
    const systemMd = readFileSync(join(process.cwd(), "SYSTEM.md"), "utf-8");
    parts.push(systemMd);
  } catch {
    parts.push("(SYSTEM.md not found — operating without system reference)");
  }

  if (includeCommands) {
    parts.push(COMMANDS_SECTION);
  }

  return `<system>\n${parts.join("\n\n")}\n</system>`;
}

/**
 * Get the current date/time string for prompt headers.
 * Uses the configured timezone, falling back to America/Toronto.
 */
export function getDateTimeString(timezone?: string): string {
  const tz = timezone || DEFAULT_TIMEZONE;
  const now = new Date();
  
  // Get timezone abbreviation (e.g., "EST", "PST")
  const tzAbbr = now.toLocaleTimeString("en-US", {
    timeZone: tz,
    timeZoneName: "short",
  }).split(" ").pop() || "ET";
  
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: tz,
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
  return `Today is ${dateStr}. Current time: ${timeStr} ${tzAbbr}.`;
}
