---
name: profile-maintenance
description: How to update user/profile.md — what's profile-worthy, where to put it, when to clean up. Read this skill any time you're about to Edit profile.md.
---

# Profile Maintenance

You own `user/profile.md`. It's the durable record of who the user is — facts they expect you to remember across days, weeks, and sessions. Read this skill before you Edit it so the file stays clean.

## When to Update

Update when the conversation reveals **durable, high-signal** facts:
- Identity: name, location, email, birthday, role
- People: family, partners, kids, pets, close colleagues, friends mentioned by name
- Work: job, side projects, ongoing initiatives, technical stack
- Interests: hobbies, sports they play, books/games/shows they care about
- Preferences: how they want things done (`uses snake_case`, `prefers concise replies`, `hates emojis in commits`)
- Strong opinions they expect you to remember (`thinks REST is fine, doesn't want GraphQL`)
- Life events: moves, transitions, milestones

## When NOT to Update

- Ephemeral state: what they're doing right now, current debugging session, the topic of this turn
- One-off mentions: someone they referenced once with no signal of recurrence
- Things they said in jest, hypotheticals, "what if" musings
- Facts about the AI, the system, debugging — only Mike-the-person facts go in
- Confirmations alone — "yeah" or "sounds good" isn't profile-worthy unless the surrounding context reveals a durable preference

If you're not sure, **don't update**. The file gets cleaner if borderline facts wait for a second mention.

## Sections

Use these section headings only — don't invent new ones unless a fact genuinely doesn't fit:

- `## Basics` — name, location, email, birthday, contact
- `## Family` — people and relationships (with `### Name` subsections for each person)
- `## Work` — job, side projects, technical stack, career history
- `## Interests` — hobbies, sports, games, media (with subsections for big ones, e.g., `### Chess`)
- `## Preferences` — how they want things done, communication style, tooling preferences
- `## Life` — formative experiences, memories, stories worth remembering
- `## Notes` — overflow for facts that don't fit elsewhere (use sparingly)

## Consolidation Rules

- **Put it in the right section.** Don't append random bullets to the bottom of the file.
- **Update existing entries.** If a fact about a known person/topic is being expanded, edit that entry — don't add a parallel duplicate.
- **Merge related facts.** Chess.com username + Lichess rating both go under `Interests > Chess`, not as separate top-level bullets.
- **Subsections for big topics.** When facts about a single person or topic accumulate, group them under `### Name` or `### Topic` rather than letting bullets sprawl.
- **One good bullet beats three fragmented ones.** Combine "uses snake_case" + "uses Python" + "no tabs" into "Python style: snake_case, spaces over tabs."

## Cleanup Bias (Aggressive)

The user prefers a lean profile. When you touch the file:
- **Delete stale facts.** "Working on project X" from six months ago when project X is finished — gone.
- **Replace, don't accumulate.** New fact supersedes old → replace it, don't keep both.
- **Merge bullets.** If two bullets cover the same ground, combine them.
- **Drop low-signal entries.** Speculative, transient, "might do this someday" stuff is clutter.
- Don't preserve wording just because it's already there. Compactness > preservation.

## Format Conventions

- Markdown, sections as `## Heading`, subsections as `### Name`, content as bullets `-`
- Bullets are short, factual, durable. No prose paragraphs.
- Don't include dates unless the date itself is the fact (birthday, anniversary). Profile is timeless.
- Don't reference yourself or the conversation ("user told me…"). Just state the fact.

## How to Edit

- **Read first.** Always Read `user/profile.md` before you Edit so you don't conflict with what's there.
- **Use Edit for surgical changes.** Don't rewrite the whole file.
- **Use Write only if creating the file or doing a major restructure.**
- **Don't ask permission for routine updates.** Just do them quietly mid-conversation. The user expects you to maintain this without ceremony.
- **One commit per turn at most.** If a single conversation reveals five facts, do them in one Edit pass — not five separate Edits.

## Examples

**Good update.** User says "btw my dog's name is Maple, she's a beagle." You Read profile, see `## Family` exists with the user's wife and son, and add a subsection:

```markdown
### Maple (dog)
- Beagle
```

**Good update — merge.** User says "I picked up Maple from the breeder last spring." Profile already has `### Maple (dog)` with `- Beagle`. You update:

```markdown
### Maple (dog)
- Beagle, picked up from breeder spring 2025
```

Not two parallel bullets.

**Skip.** User says "I'm tired today." Ephemeral, skip.

**Skip.** User says "did you remember to deploy?" Not a fact about the user — about the work. Skip.

**Cleanup pass.** While editing the Maple entry above, you notice the `## Notes` section has a stale entry: `- May be getting a dog.` Delete it (the new fact supersedes).

## Refinement Pass

Sometimes the user (or a scheduled job) will ask you to do a full **refinement pass** — not a single-fact update, but an audit of the whole file. Triggers:
- User says "refine my profile", "clean up my profile", "audit my profile", or similar
- A cron job is configured to run this on a schedule

During a refinement pass:

1. **Read the whole file.** Get the current state in front of you before editing anything.
2. **Audit every entry** against the rules in this skill:
   - Is this still durable / high-signal? Or has it gone stale?
   - Could this be merged with a related bullet?
   - Is this still true? (Ongoing projects may have finished; preferences may have shifted — consider checking memory with `keyword-history-search` or `semantic-history-search` if you're unsure.)
   - Is the section right? Should this fact move?
   - Is the wording compact, or could it be tightened?
3. **Apply the cleanup bias aggressively.** The user prefers a lean profile. When in doubt about a low-signal entry, drop it. Replace verbose bullets with tighter ones. Merge duplicates ruthlessly.
4. **Don't add facts** during a refinement pass unless the audit turns up an obvious gap (e.g., a `### Person` entry that's referenced elsewhere but missing). Refinement is about pruning and shaping, not gathering.
5. **Verify before deleting** anything that looks load-bearing. If you're tempted to delete a fact because it seems specific or odd, search memory first — it might be there for a reason.
6. **Report what changed** when you finish. A short bullet list:
   - Merged: X and Y → single entry
   - Removed: stale fact about Z
   - Moved: A from `Notes` to `Interests`
   - Tightened: B
   This helps the user understand what shifted and gives them a chance to push back.

A refinement pass is the one time it's reasonable to make a lot of edits at once. Take it seriously and leave the file in better shape than you found it.

## Profile Path

`user/profile.md`
