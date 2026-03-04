/**
 * System instructions loader.
 * 
 * All operational rules and reference material live in SYSTEM.md (hot-reloaded).
 * This file just reads it and wraps it in <system> tags for the prompt.
 */

import { readFileSync } from "fs";
import { join } from "path";

const COMMANDS_SECTION = `Available commands: /new (embed + archive session), /stop (abort current request + clear queue)`;

/**
 * Build the <system> block by reading SYSTEM.md.
 */
export function buildSystemBlock(includeCommands: boolean = true, botName: string = "Vito"): string {
  const parts: string[] = [
    `Your name is ${botName}.`,
    `If the user message is only your name (e.g., "@${botName}"), interpret it as a follow-up to the previous user message.`,
  ];

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
 * Always returns ET timezone.
 */
export function getDateTimeString(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Toronto",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
  });
  return `Today is ${dateStr}. Current time: ${timeStr} ET.`;
}
