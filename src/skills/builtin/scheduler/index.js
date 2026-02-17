import axios from 'axios';

const API_URL = 'http://localhost:3030/api/cron/jobs';

export const skill = {
  name: 'scheduler',
  description: 'Schedule and manage cron jobs to trigger AI actions at specific times',
  tools: [
    {
      name: 'schedule_job',
      description: 'Schedule a new cron job to execute an AI prompt at a specific time or interval',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Unique name for the job' },
          schedule: { type: 'string', description: 'Cron schedule expression (e.g., "0 9 * * *" for 9 AM daily, or ISO date for one-time)' },
          prompt: { type: 'string', description: 'AI prompt to execute when the job fires' },
          session: { type: 'string', description: 'Session to route the response to (format: "channel:target")', default: 'dashboard:default' },
          oneTime: { type: 'boolean', description: 'If true, job runs once and is deleted', default: false },
          sendCondition: { type: 'string', description: 'Condition that must be met for the response to be sent (e.g., "Only send if temperature is below 10°C"). If not met, response is suppressed.' }
        },
        required: ['name', 'schedule', 'prompt']
      },
      async execute({ name, schedule, prompt, session = 'dashboard:default', oneTime = false, sendCondition }) {
        if (!name || !schedule || !prompt) {
          throw new Error('Missing required parameters: name, schedule, and prompt are required');
        }

        try {
          const jobData = {
            name,
            schedule,
            prompt,
            session,
            oneTime
          };
          
          // Only include sendCondition if it's provided
          if (sendCondition) {
            jobData.sendCondition = sendCondition;
          }
          
          const response = await axios.post(API_URL, jobData);

          const jobType = oneTime ? 'one-time job' : 'recurring job';
          return `✓ Scheduled ${jobType} "${name}" - will execute: ${prompt}`;
        } catch (error) {
          if (error.response?.status === 409) {
            throw new Error(`Job "${name}" already exists. Use a different name or cancel the existing job first.`);
          }
          throw new Error(`Failed to schedule job: ${error.message}`);
        }
      }
    },
    {
      name: 'cancel_job',
      description: 'Cancel an existing scheduled cron job',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the job to cancel' }
        },
        required: ['name']
      },
      async execute({ name }) {
        if (!name) {
          throw new Error('Missing required parameter: name');
        }

        try {
          await axios.delete(`${API_URL}/${name}`);
          return `✓ Cancelled job "${name}"`;
        } catch (error) {
          if (error.response?.status === 404) {
            throw new Error(`Job "${name}" not found`);
          }
          throw new Error(`Failed to cancel job: ${error.message}`);
        }
      }
    },
    {
      name: 'list_jobs',
      description: 'List all scheduled cron jobs',
      input_schema: {
        type: 'object',
        properties: {}
      },
      async execute() {
        try {
          const response = await axios.get(API_URL);
          const jobs = response.data;

          if (jobs.length === 0) {
            return 'No scheduled jobs';
          }

          return jobs.map(job => {
            const type = job.oneTime ? '[ONE-TIME]' : '[RECURRING]';
            return `${type} ${job.name}: "${job.prompt}" (schedule: ${job.schedule}, session: ${job.session})`;
          }).join('\n');
        } catch (error) {
          throw new Error(`Failed to list jobs: ${error.message}`);
        }
      }
    }
  ]
};
