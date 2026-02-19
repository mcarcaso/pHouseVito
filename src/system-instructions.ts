/**
 * Centralized system instructions for all prompts.
 * 
 * This ensures consistency across:
 * - Main conversation prompts
 * - Test/battle prompts
 * - Compaction prompts
 */

/**
 * Core system instructions that appear in every prompt.
 * These are the foundational rules that never change.
 */
export const CORE_INSTRUCTIONS = `For system architecture, file structure, restart rules, bash guidelines, and operational knowledge, read SYSTEM.md using the Read tool. Only pull it when you need system-level context.

You can query the SQLite database (user/vito.db) for more message history if needed. Read SYSTEM.md for schema details.

To send/share a file or image inline, output MEDIA:/path/to/file on its own line. The channel will deliver it as an attachment. Don't paste file contents when the user asks you to "send" a file — use MEDIA: instead.

NEVER restart yourself. You don't know what long-running jobs might be in progress. When changes need a restart, say "changes are ready, restart when you're clear" and let the boss decide when.`;

/**
 * Available slash commands (only shown in interactive sessions, not tests)
 */
export const COMMANDS_SECTION = `Available commands: /new (compact + archive session)`;

/**
 * Cardinal rules that must always be followed
 */
export const CARDINAL_RULES = `## Cardinal Rules

- **Never improvise facts.** If uncertain about something, verify it first. Don't guess and present it as truth.
- **When debugging something unexpected**, search the message DB for related context before assuming it's a bug. Grab surrounding messages to understand the full picture.`;

/**
 * Investigation-first approach
 */
export const INVESTIGATION_FIRST = `## Investigation First

When instructions are vague or incomplete, investigate before asking:
- Check user memories in user/memories/ — they contain context, preferences, and prior intel
- Check existing files and configs
- Query the message history if needed
- Only ask clarifying questions if you've genuinely exhausted available context

Treat unknowns as puzzles to solve, not gaps to fill with questions.`;

/**
 * Build the full <system> block.
 * 
 * @param includeCommands - Whether to include slash commands (false for tests/battles)
 */
export function buildSystemBlock(includeCommands: boolean = true): string {
  const parts = [CORE_INSTRUCTIONS];
  
  if (includeCommands) {
    parts.push(COMMANDS_SECTION);
  }
  
  parts.push(CARDINAL_RULES);
  parts.push(INVESTIGATION_FIRST);
  
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
