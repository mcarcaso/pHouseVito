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

Every job schedule carries an explicit IANA timezone. Missing timezone in older definitions is normalized to America/Toronto, never inherited from global settings. A one-time schedule uses local wall time without an offset plus timezone:

```json
{ "at": "2026-09-26T09:00:00", "timezone": "America/Toronto" }
```

Never guess a session or destination. Use the current conversation when the user does not specify another one.

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
./vito jobs run morning-summary      # nonblocking server launch; progress goes to configured channel
./vito jobs history morning-summary --limit 20
./vito jobs logs morning-summary
./vito jobs cancel RUN_ID
./vito jobs remove morning-summary --yes
```

`./vito jobs run NAME` queues a local request for the running Vito server and returns immediately. The server executes the job using its existing session queues, streams prompt commentary/activity to the configured delivery channel, and delivers the script's final result normally. There is no separate `jobs start` command or blocking local execution mode.

**When invoking a job from chat, run this command and return to the user immediately. Never wait or poll for the job to finish within that turn.** The job may need `job.prompt()` in that same conversation; holding the turn open while waiting for completion creates a circular wait. The nonblocking handoff lets the current turn finish and frees the conversation for the job. No shell backgrounding or separate session is required.

The server must be running with support for this handoff. A queued request is not proof execution has started; check `jobs history NAME` in a later turn for its run/outcome. Claimed requests are never automatically replayed after a crash. Without a configured delivery destination, there is no live channel output. The dashboard's **Run now** uses the same server execution and configured delivery behavior.

`job.prompt` streams existing public commentary and activity, not private reasoning or its final answer. Final answers remain returned to the script; the script owns conditional final delivery (including `NO_REPLY`). Therefore a silent final outcome may still have shown progress.

Convert an existing declarative job deterministically:

```bash
./vito jobs convert legacy-name
./vito jobs convert --all
```

Conversion writes user-owned TypeScript under `user/jobs/`, preserves the schedule/session/condition behavior, and refuses to overwrite a different existing script.

## Scheduling behavior

- Cron schedules use their own explicit timezone, independent of `settings.timezone`. Previously local schedules default to America/Toronto.
- One-time schedules require local YYYY-MM-DDTHH:mm[:ss] without an offset and an IANA timezone. DST gaps and repeated hours are rejected. Legacy offset timestamps normalize into local wall time while preserving their instant.
- Recurring schedules catch up at most once after downtime.
- The same job cannot overlap itself.
- A claimed or uncertain run is never blindly replayed after restart.
- Pause/resume preserves the durable next occurrence.
