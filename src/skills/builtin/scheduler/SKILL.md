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
- `--session "dashboard:default"` — session to route the response to (default: "dashboard:default")
- `--oneTime true` — job runs once and is auto-deleted
- `--sendCondition "Only send if temperature is below 10°C"` — suppress response if condition not met

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
