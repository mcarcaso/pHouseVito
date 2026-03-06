#!/usr/bin/env node

/**
 * Scheduler skill CLI
 *
 * Usage:
 *   node index.js schedule --name "morning" --schedule "0 9 * * *" --prompt "Good morning!"
 *   node index.js schedule --name "once" --schedule "2025-12-25T00:00:00Z" --prompt "Merry Christmas!" --oneTime
 *   node index.js schedule --name "weather" --schedule "0 8 * * *" --prompt "Check weather" --sendCondition "Only send if rain"
 *   node index.js cancel --name "morning"
 *   node index.js list
 */

import axios from 'axios';

const API_URL = 'http://localhost:3030/api/cron/jobs';

const [,, command, ...rest] = process.argv;

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1];
      if (val === 'true') result[key] = true;
      else if (val === 'false') result[key] = false;
      else result[key] = val;
      i++;
    }
  }
  return result;
}

async function main() {
  try {
    switch (command) {
      case 'schedule': {
        const args = parseArgs(rest);
        if (!args.name || !args.schedule || !args.prompt) {
          console.error('Required: --name, --schedule, --prompt');
          process.exit(1);
        }
        const jobData = {
          name: args.name,
          schedule: args.schedule,
          prompt: args.prompt,
          session: args.session || 'dashboard:default',
          oneTime: args.oneTime || false,
        };
        if (args.sendCondition) jobData.sendCondition = args.sendCondition;

        await axios.post(API_URL, jobData);
        const jobType = jobData.oneTime ? 'one-time job' : 'recurring job';
        console.log(`Scheduled ${jobType} "${args.name}" — will execute: ${args.prompt}`);
        break;
      }

      case 'cancel': {
        const args = parseArgs(rest);
        if (!args.name) {
          console.error('Required: --name');
          process.exit(1);
        }
        await axios.delete(`${API_URL}/${args.name}`);
        console.log(`Cancelled job "${args.name}"`);
        break;
      }

      case 'list': {
        const response = await axios.get(API_URL);
        const jobs = response.data;
        if (jobs.length === 0) {
          console.log('No scheduled jobs');
        } else {
          for (const job of jobs) {
            const type = job.oneTime ? '[ONE-TIME]' : '[RECURRING]';
            console.log(`${type} ${job.name}: "${job.prompt}" (schedule: ${job.schedule}, session: ${job.session})`);
          }
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Usage: node index.js <schedule|cancel|list> [options]');
        process.exit(1);
    }
  } catch (error) {
    if (error.response?.status === 409) {
      console.error(`Job already exists. Use a different name or cancel first.`);
    } else if (error.response?.status === 404) {
      console.error(`Job not found.`);
    } else {
      console.error(`Error: ${error.message}`);
    }
    process.exit(1);
  }
}

main();
