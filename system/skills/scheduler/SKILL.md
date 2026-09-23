---
name: scheduler
description: Create and manage durable script-first TypeScript jobs with contextual or stateless model calls.
---

# Scheduler

Jobs are self-contained TypeScript files outside core code. The scheduler owns only the name, script path, schedule, optional session, timeout, enabled state, and optional delivery destination.

## Create or update a job

1. Write an absolute `.ts` file, normally under `user/jobs/`.
2. Write a JSON definition.
3. Save it with `./vito jobs save definition.json`.

```ts
export default async function (job) {
  const response = await job.prompt({
    session: "discord:CURRENT_SESSION_ID",
    message: "Prepare the morning summary.",
  });
  if (response.text.includes("NO_REPLY")) return;
  return response.text;
}
```

```json
{
  "name": "morning-summary",
  "script": "/absolute/path/user/jobs/morning-summary.ts",
  "schedule": { "cron": "0 9 * * *", "timezone": "America/Toronto" },
  "session": "discord:CURRENT_SESSION_ID",
  "timeoutMs": 300000,
  "enabled": true,
  "delivery": { "channel": "discord", "target": "CURRENT_SESSION_ID" }
}
```

A one-time schedule uses an explicit offset:

```json
{ "at": "2026-09-26T09:00:00-04:00" }
```

Never guess a session or destination. Use the current conversation when Mike does not specify another one.

## Job context

- `job.prompt({ session, message })` runs a real contextual Vito turn. It uses that session's History, tools, memory, and selected model, and records the turn in History. Calls targeting one session serialize with dashboard, Discord, and other job turns.
- `job.generate({ prompt, model?, maxTokens?, reasoning? })` is stateless, tool-free, and does not mutate a session.
- `job.signal` is aborted on cancellation or timeout.
- Return a string or `{ text, files }` for configured delivery.
- Return nothing for deliberate silence.
- Throw to mark the run failed.
- `console.log` and `console.error` go to the private job log.

Scripts own deterministic checks and conditional-send logic. Do not create new declarative `prompt`, `sendCondition`, or `precheckCommand` job fields.

## Commands

```bash
./vito jobs list
./vito jobs save /path/to/definition.json
./vito jobs pause morning-summary
./vito jobs resume morning-summary
./vito jobs run morning-summary
./vito jobs history morning-summary --limit 20
./vito jobs logs morning-summary
./vito jobs cancel RUN_ID
./vito jobs remove morning-summary --yes
```

`jobs run` is an operator/rescue execution: it prints the durable outcome and intentionally does not send configured channel delivery. Use the dashboard's **Run now** action when configured delivery is desired.

Convert an existing declarative job deterministically:

```bash
./vito jobs convert legacy-name
./vito jobs convert --all
```

Conversion writes user-owned TypeScript under `user/jobs/`, preserves the schedule/session/condition behavior, and refuses to overwrite a different existing script.

## Scheduling behavior

- Ordinary cron schedules use the agent timezone from `settings.timezone` unless the job overrides it.
- One-time schedules require an ISO timestamp with an explicit offset.
- Recurring schedules catch up at most once after downtime.
- The same job cannot overlap itself.
- A claimed or uncertain run is never blindly replayed after restart.
- Pause/resume preserves the durable next occurrence.
