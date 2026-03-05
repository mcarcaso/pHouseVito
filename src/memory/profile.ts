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

// ── Config Access ──────────────────────────────────────────

let _config: VitoConfig | null = null;

/**
 * Set the config reference for the profile updater.
 * Called from the orchestrator on startup and config reload.
 */
export function setProfileUpdaterConfig(config: VitoConfig): void {
  _config = config;
}

// ── The System Prompt ──────────────────────────────────────

const PROFILE_UPDATER_SYSTEM_PROMPT = `You are a profile updater. Your ONLY job is to update the file user/profile.md when new personal facts about Mike (the user) are revealed.

**Instructions:**
1. Read the user's message below
2. Decide if it contains ANY profile-worthy information (people, interests, preferences, contact info, life events, etc.)
3. If YES: Use the Read tool to see the current profile, then use Edit to surgically add/update the relevant section
4. If NO: Just respond "No update needed." and do nothing else

**Rules:**
- Only extract facts ABOUT Mike. Ignore facts about the AI, system operations, debugging.
- Don't add transient things (current tasks, what he's doing right now).
- DO add: new people, relationships, contact info, interests, preferences, experiences, opinions, pets, etc.
- Use Edit for surgical changes — don't rewrite the whole file.
- If adding a new section, use Write.
- Be concise — one-liner notes are fine.
- Don't duplicate info that's already there.

**Profile path:** user/profile.md`;

// ── Harness-Based Update ───────────────────────────────────

export interface ProfileUpdateResult {
  skipped?: string;
  updated: boolean;
  duration_ms: number;
  traceFile?: string;  // Path to the trace file (if created)
}

/**
 * Check if the user's message revealed any profile-worthy facts,
 * and if so, use the harness to surgically edit the profile.
 * 
 * Fire-and-forget — errors are logged but never thrown.
 * Called after every assistant message.
 * 
 * @param currentUserMessage - The current user message (directly from the event, not from DB)
 */
export async function maybeUpdateProfile(currentUserMessage: string): Promise<ProfileUpdateResult> {
  const start = Date.now();
  if (isUpdating) return { skipped: "lock_held", updated: false, duration_ms: Date.now() - start };
  isUpdating = true;

  try {
    return await _doProfileUpdate(currentUserMessage, start);
  } catch (err) {
    console.error("[Profile] Error during passive update:", err);
    return { skipped: `error: ${err instanceof Error ? err.message : String(err)}`, updated: false, duration_ms: Date.now() - start };
  } finally {
    isUpdating = false;
  }
}

async function _doProfileUpdate(currentUserMessage: string, start: number): Promise<ProfileUpdateResult> {
  // Validate input
  if (!currentUserMessage || !currentUserMessage.trim()) {
    return { skipped: "empty_message", updated: false, duration_ms: Date.now() - start };
  }

  // Need config to resolve harness settings
  if (!_config) return { skipped: "no_config", updated: false, duration_ms: Date.now() - start };

  // Check if profile exists
  if (!existsSync(PROFILE_PATH)) return { skipped: "no_profile", updated: false, duration_ms: Date.now() - start };

  // Get effective settings for the profile-updater session
  // Session format: "system:profile-updater" → channel = "system", sessionKey = full string
  const effectiveSettings = getEffectiveSettings(_config, "system", PROFILE_UPDATER_SESSION);

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

  const userPrompt = `Mike just said: "${currentUserMessage}"`;

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
    await harness.run(PROFILE_UPDATER_SYSTEM_PROMPT, userPrompt, callbacks);
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
