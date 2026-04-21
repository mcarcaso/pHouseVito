/**
 * USER PROFILE — Freeform Markdown Memory
 * 
 * A markdown file that captures WHO the user is.
 * Small enough to always inject into the system prompt.
 * Updated passively after every assistant message via a lightweight harness call.
 * 
 * - `loadProfileForPrompt()` → reads user/profile.md, returns the raw content
 * - `maybeUpdateProfile()` → fires after every assistant message, uses a harness
 *   (configurable via session "system:profile-updater") with Read/Edit tools
 *   to check if any profile-worthy facts were revealed and surgically edit the file
 */

import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import type { Queries } from "../db/queries.js";
import { PiHarness } from "../harnesses/pi-coding-agent/index.js";
import { withTracing, type TracingOptions } from "../harnesses/tracing.js";
import type { HarnessCallbacks, NormalizedEvent } from "../harnesses/types.js";
import { getEffectiveSettings } from "../settings.js";
import type { VitoConfig } from "../types.js";

// ── Config ─────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const PROFILE_PATH = join(ROOT, "user", "profile.md");

// The special session used for profile updates — configurable via vito.config.json
const PROFILE_UPDATER_SESSION = "system:profile-updater";

// ── Profile I/O ────────────────────────────────────────────

function loadProfileMarkdown(): string | null {
  if (!existsSync(PROFILE_PATH)) return null;
  try {
    return readFileSync(PROFILE_PATH, "utf-8");
  } catch (err) {
    console.error("[Profile] Failed to read profile.md:", err);
    return null;
  }
}

// ── System Prompt Formatting ───────────────────────────────

/**
 * Load the user profile and return it for injection into the system prompt.
 * Returns the raw markdown content.
 */
export function loadProfileForPrompt(): string {
  return loadProfileMarkdown() || "";
}

// ── Global Lock ────────────────────────────────────────────

let isUpdating = false;

// ── Config & Queries Access ────────────────────────────────

let _config: VitoConfig | null = null;
let _queries: Queries | null = null;

/**
 * Set the config reference for the profile updater.
 * Called from the orchestrator on startup and config reload.
 */
export function setProfileUpdaterConfig(config: VitoConfig): void {
  _config = config;
}

/**
 * Set the queries reference for the profile updater.
 * Called from the orchestrator on startup.
 */
export function setProfileUpdaterQueries(queries: Queries): void {
  _queries = queries;
}

// ── The System Prompt ──────────────────────────────────────

/**
 * Build the system prompt for the profile updater.
 * Includes the recent conversation context (N-1 messages) so the model 
 * understands the full context of the user's response.
 */
function buildProfileUpdaterSystemPrompt(contextMessages: Array<{ type: string; content: string }>): string {
  let contextSection = "";
  
  if (contextMessages.length > 0) {
    const formattedContext = contextMessages.map(msg => {
      const role = msg.type === "user" ? "Mike" : "Vito";
      return `- ${role}: "${msg.content}"`;
    }).join("\n");
    
    contextSection = `\n**Recent conversation context:**\n${formattedContext}\n`;
  }

  return `You are a profile updater. Your ONLY job is to update the file user/profile.md when new personal facts about Mike (the user) are revealed.

**Instructions:**
1. Read the conversation exchange below (use the context to understand vague responses)
2. Decide if Mike's latest message reveals ANY profile-worthy information (people, interests, preferences, contact info, life events, etc.)
3. If YES: Use the Read tool to see the current profile, then use Edit to surgically add/update the relevant section
4. If NO: Just respond "No update needed." and do nothing else
${contextSection}
**Profile Structure — Use These Sections:**
- ## Basics — name, location, email, birthday, etc.
- ## Family — people and relationships (wife, kids, parents, etc.)
- ## Work — job, side projects, career history
- ## Interests — hobbies, passions (include specifics like usernames, ratings, favorites)
- ## Preferences — likes, dislikes, how he wants things done
- ## Life — experiences, memories, stories, formative moments
- ## Notes — overflow, misc facts that don't fit elsewhere

**Consolidation Rules:**
- If a fact belongs to an existing section, PUT IT THERE — don't add random bullets at the bottom
- If updating info about someone already mentioned (e.g., wife, son), ADD to that person's existing entry — don't create duplicate entries
- Merge related facts (e.g., chess.com AND lichess info go under Interests > Chess)
- Keep entries concise but complete — one good bullet with details > three fragmented bullets
- Prefer durable, high-signal facts over chatter, one-off remarks, or implementation trivia
- When adding a new person, create a subsection (### Name) with details as bullets underneath

**Aggressive Cleanup Bias:**
- Mike explicitly prefers a lean profile. When you touch the profile, clean up nearby clutter too.
- DELETE or merge low-value, redundant, stale, overly specific, or obvious bullets instead of letting the file grow forever.
- If a new fact supersedes an old one, REPLACE the old fact — do not keep both.
- If multiple bullets can become one tighter bullet, merge them.
- Do not preserve wording just because it already exists; optimize for compactness and usefulness.
- Favor facts that will still matter later. Skip speculative, temporary, or fast-expiring details unless they are clearly recurring preferences.

**Rules:**
- Only extract facts ABOUT Mike. Ignore facts about the AI, system operations, debugging.
- Don't add transient things (current tasks, what he's doing right now).
- DO add: new people, relationships, contact info, interests, preferences, experiences, opinions, pets, etc.
- Use Edit for surgical changes — don't rewrite the whole file unless absolutely necessary.
- If adding a new section, use Write.
- Be concise — one-liner notes are fine.
- Don't duplicate info that's already there.
- If the latest message is just agreement or confirmation, only update the profile if the surrounding context reveals a durable preference or fact.
- Use the conversation context to understand vague responses (e.g., if Vito asked "do you like Chinese food?" and Mike says "I love that", the fact is "Mike loves Chinese food")

**Profile path:** user/profile.md`;
}

// ── Harness-Based Update ───────────────────────────────────

export interface ProfileUpdateResult {
  skipped?: string;
  updated: boolean;
  duration_ms: number;
  traceFile?: string;  // Path to the trace file (if created)
}

/**
 * Check if the conversation revealed any profile-worthy facts,
 * and if so, use the harness to surgically edit the profile.
 * 
 * Fire-and-forget — errors are logged but never thrown.
 * Called after every assistant message.
 * 
 * @param sessionId - The session ID to get conversation context from
 * @param currentUserMessage - The user's latest message (the trigger for the update)
 */
export async function maybeUpdateProfile(sessionId: string, currentUserMessage: string): Promise<ProfileUpdateResult> {
  const start = Date.now();
  if (isUpdating) return { skipped: "lock_held", updated: false, duration_ms: Date.now() - start };
  isUpdating = true;

  try {
    return await _doProfileUpdate(sessionId, currentUserMessage, start);
  } catch (err) {
    console.error("[Profile] Error during passive update:", err);
    return { skipped: `error: ${err instanceof Error ? err.message : String(err)}`, updated: false, duration_ms: Date.now() - start };
  } finally {
    isUpdating = false;
  }
}

async function _doProfileUpdate(sessionId: string, currentUserMessage: string, start: number): Promise<ProfileUpdateResult> {
  // Validate input
  if (!currentUserMessage || !currentUserMessage.trim()) {
    return { skipped: "empty_message", updated: false, duration_ms: Date.now() - start };
  }

  // Need config and queries to resolve harness settings and get conversation history
  if (!_config) return { skipped: "no_config", updated: false, duration_ms: Date.now() - start };
  if (!_queries) return { skipped: "no_queries", updated: false, duration_ms: Date.now() - start };

  // Check if profile exists
  if (!existsSync(PROFILE_PATH)) return { skipped: "no_profile", updated: false, duration_ms: Date.now() - start };

  // Get effective settings for the profile-updater session
  // Session format: "system:profile-updater" → channel = "system", sessionKey = full string
  const effectiveSettings = getEffectiveSettings(_config, "system", PROFILE_UPDATER_SESSION);
  
  // Get profile update context setting (default 2)
  // This is the number of CONTEXT messages we want (excluding the current trigger message)
  // So if contextLimit = 2, we want 2 context messages + the current message as the prompt
  const contextLimit = effectiveSettings.memory.profileUpdateContext;

  // When maybeUpdateProfile runs, the DB has:
  // [..., previous messages, currentUserMessage, thisAssistantResponse]
  // We want the context messages BEFORE the current user message
  // 
  // Strategy: Grab contextLimit + 2 messages, then slice off the last 2 
  // (the current user message and the assistant response we just generated)
  // This leaves us with the N messages BEFORE this turn
  const recentMessages = _queries.getLastNMessages(sessionId, contextLimit + 2);
  
  // Slice off the last 2 messages (current user + assistant response from this turn)
  // This leaves us with the context messages from BEFORE this turn
  const contextMessages = recentMessages.length > 2 
    ? recentMessages.slice(0, -2)
    : [];  // Not enough history for context

  // Create harness based on settings
  // For now, we only support pi-coding-agent for profile updates (it has Read/Edit tools)
  // Claude Code could work too, but Pi is simpler and we can use a cheap model
  const piConfig = effectiveSettings["pi-coding-agent"] || _config.harnesses?.["pi-coding-agent"];
  const model = piConfig?.model || { provider: "openai", name: "gpt-4o-mini" };
  const baseHarness = new PiHarness({
    model,
    thinkingLevel: piConfig?.thinkingLevel || "off",
    // No skills needed — just the builtin Read/Edit/Write tools
    skillsDir: undefined,
  });

  // Wrap with TracingHarness — it handles trace file creation, header, footer, all events
  const tracingOptions: TracingOptions = {
    session_id: PROFILE_UPDATER_SESSION,
    channel: "system",
    target: "profile-updater",
    model: `${model.provider}/${model.name}`,
    // Don't trace message_update events — too noisy
    traceMessageUpdates: false,
    // Use "profile" prefix so files are named trace-profile-...
    tracePrefix: "profile",
  };
  const harness = withTracing(baseHarness, tracingOptions);

  // Build the system prompt with conversation context
  const systemPrompt = buildProfileUpdaterSystemPrompt(contextMessages);

  // The user prompt is just the current message (no duplication)
  const userPrompt = `Mike said: "${currentUserMessage}"`;

  // Track if an Edit or Write tool was used
  let updated = false;
  
  const callbacks: HarnessCallbacks = {
    onRawEvent: () => {}, // TracingHarness handles this
    onNormalizedEvent: (event: NormalizedEvent) => {
      if (event.kind === "tool_end" && (event.tool === "Edit" || event.tool === "Write")) {
        updated = true;
      }
    },
  };

  // Run the harness — TracingHarness handles all tracing automatically
  try {
    await harness.run(systemPrompt, userPrompt, callbacks);
  } catch (err) {
    console.error("[Profile] Harness run failed:", err);
  }

  // Get the trace file path from the harness
  const traceFile = harness.tracePath;

  if (updated) {
    console.log(`[Profile] Profile updated via harness. Trace: ${traceFile}`);
  }

  return {
    updated,
    duration_ms: Date.now() - start,
    traceFile,
  };
}

// ── Legacy Exports (for compatibility) ─────────────────────

export interface UserProfile {
  basics?: Record<string, any>;
  people?: Array<Record<string, any>>;
  interests?: Array<Record<string, any>>;
  preferences?: Record<string, any>;
  work?: Record<string, any>;
  notes?: Array<Record<string, any>>;
}
