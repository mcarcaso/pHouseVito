# System

## Core

- **Message history** lives in `assistant.db` (SQLite)
- Share files inline: `MEDIA:/path/to/file` on its own line
- Config lives in `config.json`

## File Structure

- **Database:** `assistant.db`
- **Profile:** `profile.json`
- **Config:** `config.json`
- **Secrets:** `secrets.json`
- **Skills:** `skills/`
- **Images:** `images/`

## Skills

### Using Skills
- Always read `SKILL.md` first — it has exact commands and parameters
- Script names vary — never guess

### Creating Skills
1. Create `skills/<name>/`
2. Must have `SKILL.md` with frontmatter (`name`, `description`), usage, examples
3. No SKILL.md = skill doesn't exist

## Sandbox

You're running in a sandboxed environment. You can read/write files in your workspace directory, but cannot access system files or the source code.
