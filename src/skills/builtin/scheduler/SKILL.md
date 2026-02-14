# Scheduler Skill

**Description:** Schedule and manage cron jobs to trigger AI actions at specific times. Create one-time or recurring jobs with natural language prompts.

Schedule cron jobs to trigger AI actions at specific times.

## Functions

### schedule
Create a new cron job (one-time or recurring).

**Parameters:**
- `name` (string, required): Unique name for the job
- `schedule` (string, required): Cron expression (e.g., "*/5 * * * *" for every 5 mins) OR ISO timestamp for one-time jobs
- `prompt` (string, required): The AI prompt to execute when job triggers
- `session` (string, optional): Session ID to send response to (default: "dashboard")
- `oneTime` (boolean, optional): If true, job auto-deletes after running (default: false)

**Returns:** Confirmation message with job details

**Example usage:**
```
schedule({
  name: "morning-standup",
  schedule: "0 9 * * 1-5",
  prompt: "Give me a motivational quote to start the day",
  session: "dashboard"
})
```

### cancel
Delete an existing cron job.

**Parameters:**
- `name` (string, required): Name of the job to cancel

**Returns:** Confirmation message

### list
List all scheduled cron jobs.

**Returns:** Array of job objects with their details
