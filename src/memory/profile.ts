/**
 * USER PROFILE — Semantic Memory Layer
 * 
 * A structured JSON profile that captures WHO the user is.
 * Small enough to always inject into the system prompt.
 * Updated passively after every assistant message.
 * 
 * - `loadProfile()` → reads user/profile.json, returns formatted string for system prompt
 * - `maybeUpdateProfile()` → fires after every assistant message, uses a cheap LLM call
 *   to check if any profile-worthy facts were revealed, applies surgical updates
 * - All writes validated against the schema before saving
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import OpenAI from "openai";
import AjvModule from "ajv";
const Ajv = AjvModule.default || AjvModule;

// ── Config ─────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const PROFILE_PATH = join(ROOT, "user", "profile.json");
const SCHEMA_PATH = join(ROOT, "src", "memory", "profile.schema.json");
const EXTRACTION_MODEL = "openai/gpt-4o-mini";

let openrouterApiKey: string | null = null;

function getOpenRouterKey(): string {
  if (!openrouterApiKey) {
    const secrets = JSON.parse(readFileSync(join(ROOT, "user", "secrets.json"), "utf-8"));
    openrouterApiKey = secrets.OPENROUTER_API_KEY;
  }
  return openrouterApiKey!;
}

// ── Schema Validation ──────────────────────────────────────

let ajvValidate: any = null;

function getValidator(): any {
  if (!ajvValidate) {
    const ajv = new Ajv({ allErrors: true });
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"));
    ajvValidate = ajv.compile(schema);
  }
  return ajvValidate;
}

function validateProfile(profile: any): { valid: boolean; errors: string[] } {
  const validate = getValidator();
  const valid = validate(profile);
  if (!valid) {
    const errors = (validate.errors || []).map(
      (e: any) => `${e.instancePath || "/"}: ${e.message}`
    );
    return { valid: false, errors };
  }
  return { valid: true, errors: [] };
}

// ── Profile I/O ────────────────────────────────────────────

export interface UserProfile {
  basics?: {
    name?: string;
    email?: string;
    phone?: string;
    timezone?: string;
    location?: string;
    faith?: string;
  };
  people?: Array<{
    name: string;
    relation: string;
    email?: string;
    phone?: string;
    notes?: string[];
  }>;
  interests?: Array<{
    topic: string;
    level?: "obsessed" | "active" | "casual" | "learning";
    notes?: string[];
  }>;
  preferences?: {
    communication?: string[];
    code?: string[];
    design?: string[];
  };
  work?: {
    employer?: string;
    role?: string;
    side_projects?: string[];
  };
  notes?: Array<{
    key: string;
    value: string;
  }>;
}

function loadProfileJSON(): UserProfile | null {
  if (!existsSync(PROFILE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(PROFILE_PATH, "utf-8"));
  } catch (err) {
    console.error("[Profile] Failed to parse profile.json:", err);
    return null;
  }
}

function saveProfile(profile: UserProfile): boolean {
  const { valid, errors } = validateProfile(profile);
  if (!valid) {
    console.error("[Profile] Validation failed, NOT saving:", errors);
    return false;
  }
  writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), "utf-8");
  return true;
}

// ── System Prompt Formatting ───────────────────────────────

/**
 * Load the user profile and format it for injection into the system prompt.
 * Returns a concise, readable summary — NOT raw JSON.
 */
export function loadProfileForPrompt(): string {
  const profile = loadProfileJSON();
  if (!profile) return "";

  const lines: string[] = [];

  // Basics
  if (profile.basics) {
    const b = profile.basics;
    const parts = [b.name, b.email, b.phone, b.location, b.timezone].filter(Boolean);
    if (parts.length) lines.push(`**User:** ${parts.join(" | ")}`);
    if (b.faith) lines.push(`**Faith:** ${b.faith}`);
  }

  // People
  if (profile.people && profile.people.length > 0) {
    lines.push(`**People:**`);
    for (const p of profile.people) {
      let line = `- ${p.name} (${p.relation})`;
      const extras: string[] = [];
      if (p.phone) extras.push(p.phone);
      if (p.email) extras.push(p.email);
      if (extras.length) line += ` — ${extras.join(", ")}`;
      if (p.notes && p.notes.length) line += ` [${p.notes.join("; ")}]`;
      lines.push(line);
    }
  }

  // Interests
  if (profile.interests && profile.interests.length > 0) {
    lines.push(`**Interests:**`);
    for (const i of profile.interests) {
      let line = `- ${i.topic}`;
      if (i.level) line += ` (${i.level})`;
      if (i.notes && i.notes.length) line += `: ${i.notes.join("; ")}`;
      lines.push(line);
    }
  }

  // Preferences
  if (profile.preferences) {
    const { communication, code, design } = profile.preferences;
    if (communication?.length || code?.length || design?.length) {
      lines.push(`**Preferences:**`);
      if (communication?.length) lines.push(`- Communication: ${communication.join("; ")}`);
      if (code?.length) lines.push(`- Code: ${code.join("; ")}`);
      if (design?.length) lines.push(`- Design: ${design.join("; ")}`);
    }
  }

  // Work
  if (profile.work) {
    const { employer, role, side_projects } = profile.work;
    if (employer || role) {
      lines.push(`**Work:** ${role || ""} @ ${employer || ""}`);
    }
    if (side_projects?.length) {
      lines.push(`- Side projects: ${side_projects.join(", ")}`);
    }
  }

  // Notes (freeform)
  if (profile.notes && profile.notes.length > 0) {
    lines.push(`**Notes:**`);
    for (const n of profile.notes) {
      lines.push(`- ${n.key}: ${n.value}`);
    }
  }

  return lines.join("\n");
}

// ── Global Lock ────────────────────────────────────────────

let isUpdating = false;

// ── Passive Update ─────────────────────────────────────────

interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
}

/**
 * Check if the recent exchange revealed any profile-worthy facts,
 * and if so, apply surgical updates.
 * 
 * Fire-and-forget — errors are logged but never thrown.
 * Called after every assistant message, same as maybeEmbedNewChunks.
 */
export interface ProfileUpdateResult {
  skipped?: string;
  updates_applied: number;
  updates: Array<{ path: string; action: string; value: any }>;
  duration_ms: number;
}

export async function maybeUpdateProfile(recentMessages: ConversationMessage[]): Promise<ProfileUpdateResult> {
  const start = Date.now();
  if (isUpdating) return { skipped: "lock_held", updates_applied: 0, updates: [], duration_ms: Date.now() - start };
  isUpdating = true;

  try {
    return await _doProfileUpdate(recentMessages, start);
  } catch (err) {
    console.error("[Profile] Error during passive update:", err);
    return { skipped: `error: ${err instanceof Error ? err.message : String(err)}`, updates_applied: 0, updates: [], duration_ms: Date.now() - start };
  } finally {
    isUpdating = false;
  }
}

async function _doProfileUpdate(recentMessages: ConversationMessage[], start: number): Promise<ProfileUpdateResult> {
  if (recentMessages.length === 0) return { skipped: "no_messages", updates_applied: 0, updates: [], duration_ms: Date.now() - start };

  const profile = loadProfileJSON();
  if (!profile) return { skipped: "no_profile", updates_applied: 0, updates: [], duration_ms: Date.now() - start };

  // Format recent messages for the extraction prompt
  const conversationText = recentMessages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
    .join("\n");

  const openai = new OpenAI({ apiKey: getOpenRouterKey(), baseURL: "https://openrouter.ai/api/v1" });

  const response = await openai.chat.completions.create({
    model: EXTRACTION_MODEL,
    max_tokens: 500,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You analyze conversations to extract personal facts about the user that should be stored in their profile. The profile has this structure:

- basics: { name, email, phone, timezone, location, faith }
- people: [{ name, relation, email, phone, notes[] }]
- interests: [{ topic, level (obsessed|active|casual|learning), notes[] }]
- preferences: { communication[], code[], design[] }
- work: { employer, role, side_projects[] }
- notes: [{ key, value }] — freeform catch-all for anything else

Current profile:
${JSON.stringify(profile, null, 2)}

Rules:
- Only extract NEW or CHANGED facts about the user. If the info is already in the profile, skip it.
- Don't extract facts about the AI assistant, system operations, or technical debugging.
- Don't extract transient/ephemeral things (what they're doing right now, current mood).
- DO extract: new people, changed contact info, new interests, changed preferences, life events, relationships.
- Return a JSON object with an "updates" array. Each update has:
  - "path": JSON path to update (e.g., "basics.phone", "people[name=Norma].phone", "notes[key=tickers].value", "interests[topic=Chess].notes")
  - "action": "set" | "add" | "remove" | "add_item" (add_item = append to an array)
  - "value": the new value
- If there's nothing to update, return: { "updates": [] }
- Be conservative — only extract facts you're confident about.`
      },
      {
        role: "user",
        content: `Recent conversation:\n\n${conversationText}\n\nExtract any profile updates.`
      }
    ]
  });

  const content = response.choices[0].message.content;
  if (!content) return { skipped: "empty_llm_response", updates_applied: 0, updates: [], duration_ms: Date.now() - start };

  let result: { updates: Array<{ path: string; action: string; value: any }> };
  try {
    result = JSON.parse(content);
  } catch {
    console.error("[Profile] Failed to parse LLM response:", content);
    return { skipped: "parse_error", updates_applied: 0, updates: [], duration_ms: Date.now() - start };
  }

  if (!result.updates || result.updates.length === 0) return { skipped: "no_updates_found", updates_applied: 0, updates: [], duration_ms: Date.now() - start };

  console.log(`[Profile] Applying ${result.updates.length} update(s)...`);

  // Apply updates surgically
  let modified = JSON.parse(JSON.stringify(profile)); // deep clone
  const appliedUpdates: ProfileUpdateResult["updates"] = [];

  for (const update of result.updates) {
    try {
      modified = applyUpdate(modified, update.path, update.action, update.value);
      appliedUpdates.push(update);
      console.log(`[Profile] ✅ ${update.action} ${update.path} = ${JSON.stringify(update.value).slice(0, 100)}`);
    } catch (err) {
      console.error(`[Profile] ❌ Failed to apply update ${update.path}:`, err);
    }
  }

  // Validate and save
  if (saveProfile(modified)) {
    console.log(`[Profile] Profile updated and saved.`);
  }

  return { updates_applied: appliedUpdates.length, updates: appliedUpdates, duration_ms: Date.now() - start };
}

// ── Surgical Update Logic ──────────────────────────────────

/**
 * Apply a single update to the profile object.
 * 
 * Supports paths like:
 * - "basics.phone" → set a simple field
 * - "people[name=Norma].phone" → find an array item by a field, then set a property
 * - "people[name=Norma].notes" → with action "add_item", append to the notes array
 * - "notes[key=tickers].value" → find a note by key, update its value
 * - "people" → with action "add", push a new object to the array
 * - "interests" → with action "add", push a new interest
 */
function applyUpdate(profile: any, path: string, action: string, value: any): any {
  // Parse the path into segments
  const segments = parsePath(path);

  if (action === "add" && segments.length === 1) {
    // Adding a new item to a top-level array
    const key = segments[0].key;
    if (!Array.isArray(profile[key])) {
      profile[key] = [];
    }
    profile[key].push(value);
    return profile;
  }

  if (action === "remove" && segments.length === 1) {
    // Removing from a top-level field
    delete profile[segments[0].key];
    return profile;
  }

  // Navigate to the target
  let target = profile;
  for (let i = 0; i < segments.length - 1; i++) {
    target = resolveSegment(target, segments[i]);
    if (target === undefined) {
      throw new Error(`Path segment not found: ${segments[i].key}`);
    }
  }

  const lastSegment = segments[segments.length - 1];
  const finalTarget = segments.length > 1 ? target : profile;

  if (lastSegment.filter) {
    // Resolve the filtered array item
    const arr = finalTarget[lastSegment.key];
    if (!Array.isArray(arr)) throw new Error(`${lastSegment.key} is not an array`);
    const item = arr.find((el: any) => el[lastSegment.filter!.field] === lastSegment.filter!.value);
    if (!item) throw new Error(`No item found where ${lastSegment.filter!.field}=${lastSegment.filter!.value}`);
    
    if (lastSegment.subKey) {
      if (action === "add_item" && Array.isArray(item[lastSegment.subKey])) {
        if (!item[lastSegment.subKey].includes(value)) {
          item[lastSegment.subKey].push(value);
        }
      } else if (action === "remove" && Array.isArray(item[lastSegment.subKey])) {
        item[lastSegment.subKey] = item[lastSegment.subKey].filter((v: any) => v !== value);
      } else {
        item[lastSegment.subKey] = value;
      }
    } else {
      // Action on the matched item itself
      if (action === "remove") {
        const idx = arr.indexOf(item);
        if (idx >= 0) arr.splice(idx, 1);
      } else {
        Object.assign(item, value);
      }
    }
  } else {
    // Simple key path
    if (action === "add_item" && Array.isArray(finalTarget[lastSegment.key])) {
      if (!finalTarget[lastSegment.key].includes(value)) {
        finalTarget[lastSegment.key].push(value);
      }
    } else if (action === "set") {
      finalTarget[lastSegment.key] = value;
    } else if (action === "remove") {
      delete finalTarget[lastSegment.key];
    }
  }

  return profile;
}

interface PathSegment {
  key: string;
  filter?: { field: string; value: string };
  subKey?: string;
}

/**
 * Parse a path like "people[name=Norma].phone" into segments:
 * [{ key: "people", filter: { field: "name", value: "Norma" }, subKey: "phone" }]
 */
function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];

  // Split on dots but respect brackets
  const parts = path.match(/[^.[\]]+|\[[^\]]*\]/g) || [];
  
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    
    if (part.startsWith("[") && part.includes("=")) {
      // This is a filter — attach to previous segment
      const inner = part.slice(1, -1); // remove [ ]
      const [field, ...rest] = inner.split("=");
      const val = rest.join("="); // handle values with = in them
      
      if (segments.length > 0) {
        segments[segments.length - 1].filter = { field, value: val };
      }
    } else {
      // Regular key
      const segment: PathSegment = { key: part };
      segments.push(segment);
      
      // Peek ahead for filter
      if (i + 1 < parts.length && parts[i + 1].startsWith("[")) {
        const filterPart = parts[i + 1].slice(1, -1);
        const [field, ...rest] = filterPart.split("=");
        segment.filter = { field, value: rest.join("=") };
        i++; // skip the filter part
        
        // And peek for subKey after filter
        if (i + 1 < parts.length && !parts[i + 1].startsWith("[")) {
          segment.subKey = parts[i + 1];
          i++;
        }
      }
    }
    
    i++;
  }

  return segments;
}

function resolveSegment(target: any, segment: PathSegment): any {
  let result = target[segment.key];
  if (segment.filter && Array.isArray(result)) {
    result = result.find((el: any) => el[segment.filter!.field] === segment.filter!.value);
  }
  if (segment.subKey && result) {
    result = result[segment.subKey];
  }
  return result;
}
