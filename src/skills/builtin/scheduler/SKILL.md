# Scheduler Skill

**Description:** Schedule and manage cron jobs to trigger AI actions at specific times. Create one-time or recurring jobs with natural language prompts.

## Timezone

Jobs are scheduled using the **global timezone** from `settings.timezone` in `vito.config.json`. Each job can also override this with a per-job `timezone` field. If nothing is set, defaults to `America/Toronto`.

**The timezone ACTUALLY WORKS** — jobs will fire at the specified time in the configured timezone, not system time. This is powered by `croner` with native timezone support.

**Priority order:** Per-job timezone > Global `settings.timezone` > `America/Toronto` default

### Setting the timezone

In `vito.config.json`:
```json
{
  "settings": {
    "timezone": "America/New_York"
  }
}
```

Or per-job (when scheduling):
```bash
node src/skills/builtin/scheduler/index.js schedule \
  --name "london-report" \
  --schedule "0 9 * * 1-5" \
  --timezone "Europe/London" \
  --prompt "Good morning London!"
```

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
- `--timezone "America/New_York"` — override global timezone for this job
- `--sendCondition "Only send if temperature is below 10°C"` — suppress response if condition not met

### One-time jobs with ISO dates
```bash
node src/skills/builtin/scheduler/index.js schedule \
  --name "reminder" \
  --schedule "2026-04-06T09:45:00" \
  --prompt "Check your email for the presale code!"
```

ISO dates are interpreted in the job's effective timezone (job > global > default).

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
  → next run: 3/25/2026, 9:00:00 AM
```

## Troubleshooting

**Jobs firing at wrong time?**
1. Check `settings.timezone` in `vito.config.json`
2. Run `list` to see which timezone each job is using
3. The output shows next run time in the job's timezone

**Valid timezone strings:**
- `America/Toronto`, `America/New_York`, `America/Los_Angeles`
- `Europe/London`, `Europe/Paris`, `Asia/Tokyo`
- Full list: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
