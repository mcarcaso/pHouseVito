---
name: profile
description: Maintain and discover updates for user/profile.md — what belongs, how to edit, daily discovery sweeps, and refinement passes
---

# Profile

Use this skill whenever you are about to edit `user/profile.md`, run a profile discovery sweep, or refine/clean the profile.

`user/profile.md` is the durable record of who the user is: identity, people, stable preferences, projects, interests, routines, and strong opinions they expect remembered.

## Core Rule

Keep the profile **lean, durable, and useful**. Better to skip a borderline fact than turn the profile into a junk drawer.

## What Belongs

Update when a conversation reveals durable, high-signal facts:

- Identity: name, location, email, birthday, role
- People: family, partners, kids, pets, close colleagues, close friends
- Work: job, side projects, ongoing initiatives, technical stack
- Interests: hobbies, sports, games, media, music, fitness
- Preferences: how they want things done, tooling defaults, communication style
- Strong opinions they expect remembered
- Life events or stable personal context

## What Does Not Belong

Do not add:

- temporary moods, plans, symptoms, or logistics
- one-off product questions or research tasks
- speculative “maybe” facts
- jokes/hypotheticals
- routine confirmations
- facts about the agent/system/debugging unless they reveal a durable user preference
- every detail from a project conversation when a project note or file would be better

## Read Before Editing

Before editing:

1. Read `user/profile.md`.
2. Check whether the fact already exists.
3. Prefer updating/merging an existing bullet over adding a duplicate.
4. Use surgical edits; do not rewrite the whole file unless doing a deliberate refinement pass.

## Sections

Use existing profile sections. Common sections:

- `## Basics`
- `## Family`
- `## Work`
- `## People`
- `## Interests`
- `## Preferences`
- `## Life`
- `## Notes` sparingly

Do not invent new sections unless truly necessary.

## Edit Style

- Markdown bullets.
- Short factual wording.
- No “user said…” phrasing.
- No dates unless the date itself matters.
- Replace stale facts rather than accumulating contradictions.
- Merge related facts into one strong bullet.

## Cleanup Bias

When touching the profile:

- delete stale low-signal facts if you notice them
- compact verbose bullets
- merge duplicates
- remove superseded speculation

## Profile Discovery Sweep

Use this when asked to “run profile discovery,” “profile sweep,” “daily profile update,” or similar.

Default window: last 24 hours across all sessions.

### Step 1 — Count Recent Activity

Use the message database through the history-search conventions. Example:

```bash
sqlite3 user/vito.db <<'SQL'
SELECT
  COUNT(*) AS total_messages,
  SUM(CASE WHEN type='user' THEN 1 ELSE 0 END) AS user_messages,
  SUM(LENGTH(CAST(content AS TEXT))) AS total_chars,
  SUM(CASE WHEN type='user' THEN LENGTH(CAST(content AS TEXT)) ELSE 0 END) AS user_chars
FROM messages
WHERE timestamp >= (strftime('%s','now','-24 hours') * 1000)
  AND type IN ('user','assistant');
SQL
```

### Step 2 — Choose Mode

Use **raw transcript mode** when manageable, roughly:

- `user_messages <= 80`
- `user_chars <= 40000`
- `total_chars <= 120000`

Pull exact messages:

```bash
sqlite3 user/vito.db <<'SQL'
.mode json
SELECT
  session_id,
  datetime(timestamp/1000,'unixepoch','localtime') AS time,
  type,
  author,
  content
FROM messages
WHERE timestamp >= (strftime('%s','now','-24 hours') * 1000)
  AND type IN ('user','assistant')
ORDER BY session_id, timestamp ASC;
SQL
```

Use **semantic probe mode** when raw transcript would be too large. Run broad durable-fact probes, then fetch exact surrounding messages before editing. Example probes:

```bash
node user/scripts/search-memory.mjs "durable user preference changed going forward remember default" --limit 8
node user/scripts/search-memory.mjs "family wife parents siblings personal update durable" --limit 8
node user/scripts/search-memory.mjs "tools workflow coding UI dashboard durable preference" --limit 8
node user/scripts/search-memory.mjs "fitness injury training workout durable preference equipment" --limit 8
node user/scripts/search-memory.mjs "travel packing hotel airport durable preference" --limit 8
node user/scripts/search-memory.mjs "music guitar Bible music durable preference" --limit 8
```

### Step 3 — Candidate Criteria

Apply only when the candidate is:

- durable
- high-signal
- clear, non-speculative
- supported by exact message context
- new or a clear replacement/merge for an existing profile entry

Strong signals include:

- “remember”
- “going forward”
- “from now on”
- “I prefer” / “I hate” / “I use”
- stable family/work/identity/context facts

### Step 4 — Edit

Edit `user/profile.md` directly. Apply only high-confidence changes. Skip uncertain candidates and mention them in the final note if useful.

### Step 5 — Report

Keep the final report short:

```text
Profile discovery done.

Applied:
- Added X.
- Updated Y.

Skipped:
- Z — too speculative / trip-specific / already present.
```

If nothing changed:

```text
Profile discovery done. No high-confidence profile updates found.
```

## Refinement Pass

Use when asked to refine/clean/audit the profile.

1. Read the whole profile.
2. Check every entry for durability, correctness, duplication, and section fit.
3. Search memory before deleting anything that looks load-bearing.
4. Aggressively prune stale/low-signal facts.
5. Report concise changes: merged, removed, moved, tightened.

## Safety

Do routine profile updates quietly without asking. Do not add sensitive facts unless they are clearly useful and expected to be remembered. If unsure, skip.
