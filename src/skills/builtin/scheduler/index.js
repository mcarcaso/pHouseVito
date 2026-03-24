#!/usr/bin/env node

/**
 * Scheduler skill CLI
 *
 * Usage:
 *   node index.js schedule --name "morning" --schedule "0 9 * * *" --prompt "Good morning!"
 *   node index.js schedule --name "once" --schedule "2025-12-25T00:00:00" --prompt "Merry Christmas!" --oneTime
 *   node index.js schedule --name "london" --schedule "0 9 * * *" --prompt "London report" --timezone "Europe/London"
 *   node index.js schedule --name "weather" --schedule "0 8 * * *" --prompt "Check weather" --sendCondition "Only send if rain"
 *   node index.js cancel --name "morning"
 *   node index.js list
 */

import axios from 'axios';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_URL = 'http://localhost:3030/api/cron/jobs';
const DEFAULT_TIMEZONE = 'America/Toronto';

/**
 * Get the configured timezone from vito.config.json
 */
function getGlobalTimezone() {
  try {
    // Navigate from skills/builtin/scheduler to project root
    const configPath = resolve(__dirname, '../../../../user/vito.config.json');
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      return config.settings?.timezone || DEFAULT_TIMEZONE;
    }
  } catch {
    // Ignore errors, use default
  }
  return DEFAULT_TIMEZONE;
}

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
          console.error('Optional: --session, --oneTime, --timezone, --sendCondition');
          process.exit(1);
        }
        
        const jobData = {
          name: args.name,
          schedule: args.schedule,
          prompt: args.prompt,
          session: args.session || 'dashboard:default',
          oneTime: args.oneTime || false,
        };
        
        // Per-job timezone support
        if (args.timezone) {
          jobData.timezone = args.timezone;
        }
        
        if (args.sendCondition) {
          jobData.sendCondition = args.sendCondition;
        }

        const response = await axios.post(API_URL, jobData);
        const job = response.data;
        
        const jobType = jobData.oneTime ? 'one-time job' : 'recurring job';
        const effectiveTz = args.timezone || getGlobalTimezone();
        
        console.log(`✅ Scheduled ${jobType} "${args.name}" (timezone: ${effectiveTz})`);
        console.log(`  → schedule: ${args.schedule}`);
        console.log(`  → session: ${jobData.session}`);
        console.log(`  → will execute: "${args.prompt}"`);
        if (job.nextRun) {
          console.log(`  → next run: ${new Date(job.nextRun).toLocaleString('en-US', { timeZone: effectiveTz })}`);
        }
        break;
      }

      case 'cancel': {
        const args = parseArgs(rest);
        if (!args.name) {
          console.error('Required: --name');
          process.exit(1);
        }
        await axios.delete(`${API_URL}/${args.name}`);
        console.log(`✅ Cancelled job "${args.name}"`);
        break;
      }

      case 'list': {
        const response = await axios.get(API_URL);
        const jobs = response.data;
        if (jobs.length === 0) {
          console.log('No scheduled jobs');
        } else {
          const globalTz = getGlobalTimezone();
          console.log(`Global timezone: ${globalTz}\n`);
          for (const job of jobs) {
            const type = job.oneTime ? '[ONE-TIME]' : '[RECURRING]';
            const jobTz = job.timezone || globalTz;
            const tzNote = job.timezone ? ` [tz: ${job.timezone}]` : '';
            console.log(`${type} ${job.name}${tzNote}`);
            console.log(`  schedule: ${job.schedule}`);
            console.log(`  session: ${job.session}`);
            console.log(`  prompt: "${job.prompt}"`);
            if (job.nextRun) {
              console.log(`  next run: ${new Date(job.nextRun).toLocaleString('en-US', { timeZone: jobTz })}`);
            }
            if (job.sendCondition) {
              console.log(`  condition: ${job.sendCondition}`);
            }
            console.log('');
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
      console.error(`❌ Job already exists. Use a different name or cancel first.`);
    } else if (error.response?.status === 404) {
      console.error(`❌ Job not found.`);
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
    process.exit(1);
  }
}

main();
