# Scheduler Skill

**Description:** Schedule and manage cron jobs to trigger AI actions at specific times. Create one-time or recurring jobs with natural language prompts.

## Timezone

Jobs are scheduled using the **global timezone** from `settings.timezone` in `vito.config.json`. If not set, defaults to `America/Toronto`.

The output will confirm which timezone is being used when you schedule or list jobs.

## How to Use

Run the CLI script at `src/skills/builtin/scheduler/index.js`:

### Schedule a job
```bash
node src/skills/builtin/scheduler/index.js schedule \
  --name "morning-standup" \
  --schedule "0 9 * * 1-5" \
  --prompt "Give me a motivational quote to start the day"
```

Optional flags:
- `--session "dashboard:default"` — session to route the response to
- `--oneTime true` — job runs once and is auto-deleted
- `--sendCondition "Only send if temperature is below 10°C"` — suppress response if condition not met

## Session Handling — IMPORTANT

**If the user doesn't specify which session to use, ALWAYS use the current session** (the one you're responding in). Never hallucinate or guess a session ID. You have access to the current session in your context — use it.

❌ **Wrong:** Making up a session like `discord:1234567890` or defaulting to `dashboard:default` when unspecified
✅ **Right:** Using the actual session from your current conversation context (e.g., `discord:1466899925127266325` if that's where you're talking)

### Cancel a job
```bash
node src/skills/builtin/scheduler/index.js cancel --name "morning-standup"
```

### List all jobs
```bash
node src/skills/builtin/scheduler/index.js list
```

## Example Output

```
Scheduled recurring job "morning-standup" (timezone: America/Toronto)
  → will execute: "Give me a motivational quote to start the day"
```
