import { localJobTime } from "../../shared/job-time.js";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { Cron } from "croner";
import { RootContext } from "../../context/RootContext.js";
import { createDatabase } from "../../lib/sqlite/database.js";
import { CronerCronService } from "../../services/cron/CronerCronService.js";
import { xJobService, xVitoService } from "../../lib/x.js";
import {
  isScriptJob,
  scriptJobConfigSchema,
  type LegacyCronJobConfig,
  type ScriptJobConfig,
} from "../../shared/schemas/vito-config.js";

const help = `Usage: vito jobs <command> [arguments] [options]

Commands:
  list                         List configured jobs
  save FILE                    Create or update a script job from JSON
  pause NAME                   Pause a script job
  resume NAME                  Resume a script job
  run NAME                     Run now without channel delivery
  cancel RUN_ID                Cancel an active run
  remove NAME --yes            Remove a job
  history [NAME]               Show recent run history
  logs NAME                    Print the private job log
  convert NAME                 Convert one legacy job to TypeScript
  convert --all                Convert every legacy job

Options:
  --json                       Print stable JSON output
  --user-dir PATH              Use an explicit Vito user directory
  --yes                        Confirm destructive removal
  --limit N                    Bound history results (1-1000)
  -h, --help                   Show this help
`;

interface Options {
  positional: string[];
  json: boolean;
  yes: boolean;
  all: boolean;
  userDir: string;
  limit: number;
}

function parseOptions(args: string[], projectRoot: string): Options {
  const result: Options = {
    positional: [],
    json: false,
    yes: false,
    all: false,
    userDir: process.env.VITO_USER_DIR ?? join(projectRoot, "user"),
    limit: 50,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json") result.json = true;
    else if (arg === "--yes") result.yes = true;
    else if (arg === "--all") result.all = true;
    else if (arg === "--user-dir") {
      const path = args[++index];
      if (!path) throw new Error("--user-dir requires a path");
      result.userDir = resolve(process.cwd(), path);
    } else if (arg === "--limit") {
      const value = Number(args[++index]);
      if (!Number.isInteger(value) || value < 1 || value > 1_000) {
        throw new Error("--limit must be an integer from 1 to 1000");
      }
      result.limit = value;
    } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else result.positional.push(arg);
  }
  return result;
}

function print(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) process.stdout.write(`${JSON.stringify(entry)}\n`);
  } else process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value)}\n`);
}

function assertScript(job: ScriptJobConfig): void {
  if (!job.script.startsWith("/") || !job.script.endsWith(".ts")) {
    throw new Error("Job script must be an absolute .ts path");
  }
  if (!existsSync(job.script)) throw new Error(`Job script does not exist: ${job.script}`);
}

function scriptForLegacy(job: LegacyCronJobConfig): string {
  const conditionPrompt = job.sendCondition
    ? `${job.prompt}\n\nIMPORTANT: After your analysis, if the following condition is NOT met, respond with exactly 'NO_REPLY' and nothing else. Condition: ${job.sendCondition}`
    : job.prompt;
  const precheck = job.precheckCommand
    ? `\n  try {\n    const { stdout } = await exec(${JSON.stringify(job.precheckCommand)}, { timeout: 30_000, maxBuffer: 1024 * 1024 });\n    if (!["true", "1", "yes", "run", ""].includes(stdout.trim().toLowerCase())) return;\n  } catch {\n    return;\n  }`
    : "";
  const importLine = job.precheckCommand
    ? 'import { promisify } from "node:util";\nimport { exec as execCallback } from "node:child_process";\nconst exec = promisify(execCallback);\n\n'
    : "";
  return `${importLine}export default async function (job) {${precheck}\n  const response = await job.prompt({ session: ${JSON.stringify(job.session)}, message: ${JSON.stringify(conditionPrompt)} });\n  if (response.text.includes("NO_REPLY")) return;\n  return response.text;\n}\n`;
}

function convertedSchedule(job: LegacyCronJobConfig): ScriptJobConfig["schedule"] {
  if (/^\d{4}-\d{2}-\d{2}T/.test(job.schedule))
    return {
      at: localJobTime(job.schedule, job.timezone ?? "America/Toronto"),
      timezone: job.timezone ?? "America/Toronto",
    };
  if (job.oneTime) {
    const cron = new Cron(job.schedule, { paused: true, timezone: job.timezone });
    const next = cron.nextRun();
    cron.stop();
    if (!next) throw new Error(`Legacy job ${job.name} has no next run`);
    return {
      at: localJobTime(next.toISOString(), job.timezone ?? "America/Toronto"),
      timezone: job.timezone ?? "America/Toronto",
    };
  }
  return { cron: job.schedule, timezone: job.timezone ?? "America/Toronto" };
}

function convertLegacy(job: LegacyCronJobConfig, userDir: string): ScriptJobConfig {
  const jobsDir = join(userDir, "jobs");
  mkdirSync(jobsDir, { recursive: true });
  const safeName = job.name.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "job";
  const path = join(jobsDir, `${safeName}.ts`);
  const content = scriptForLegacy(job);
  if (existsSync(path) && readFileSync(path, "utf-8") !== content) {
    throw new Error(`Refusing to overwrite existing conversion script: ${path}`);
  }
  if (!existsSync(path)) {
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, content, { encoding: "utf-8", mode: 0o600 });
    renameSync(temporary, path);
  }
  const [channel, ...targetParts] = job.session.split(":");
  return scriptJobConfigSchema.parse({
    name: job.name,
    script: path,
    schedule: convertedSchedule(job),
    session: job.session,
    timeoutMs: 300_000,
    enabled: true,
    delivery: { channel: channel || "dashboard", target: targetParts.join(":") || "default" },
  });
}

export async function runJobsCommand(args: string[], projectRoot: string): Promise<number> {
  const [command, ...rawOptions] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(help);
    return 0;
  }

  let options: Options;
  try {
    options = parseOptions(rawOptions, projectRoot);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  mkdirSync(options.userDir, { recursive: true });
  const db = createDatabase(join(options.userDir, "vito.db"));
  const x = RootContext({
    db,
    userDir: options.userDir,
    projectDir: projectRoot,
    skillsDir: join(options.userDir, "skills"),
    logsDir: join(options.userDir, "logs"),
  });

  try {
    const vito = xVitoService(x);
    const config = vito.getConfig(x);
    const find = (name: string) => config.cron.jobs.findIndex((job) => job.name === name);

    if (command === "list") {
      if (options.positional.length) throw new Error("Usage: vito jobs list [--json]");
      print(
        config.cron.jobs.map((job) => ({ ...job, legacy: !isScriptJob(job) })),
        options.json,
      );
      return 0;
    }

    if (command === "save") {
      if (options.positional.length !== 1) throw new Error("Usage: vito jobs save FILE");
      const path = resolve(process.cwd(), options.positional[0]);
      const job = scriptJobConfigSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
      assertScript(job);
      const scheduleError = new CronerCronService().getScheduleError(
        x,
        job,
        config.settings.timezone,
      );
      if (scheduleError) throw new Error(scheduleError);
      const index = find(job.name);
      if (index === -1) config.cron.jobs.push(job);
      else if (!isScriptJob(config.cron.jobs[index])) {
        throw new Error("Convert the legacy job before replacing it");
      } else config.cron.jobs[index] = job;
      vito.saveConfig(x, config);
      print(job, options.json);
      return 0;
    }

    if (command === "pause" || command === "resume") {
      if (options.positional.length !== 1) throw new Error(`Usage: vito jobs ${command} NAME`);
      const index = find(options.positional[0]);
      const existing = config.cron.jobs[index];
      if (!existing) throw new Error("Job not found");
      if (!isScriptJob(existing)) throw new Error("Convert this legacy job first");
      config.cron.jobs[index] = { ...existing, enabled: command === "resume" };
      vito.saveConfig(x, config);
      print(config.cron.jobs[index], options.json);
      return 0;
    }

    if (command === "remove") {
      if (options.positional.length !== 1) throw new Error("Usage: vito jobs remove NAME --yes");
      if (!options.yes) throw new Error("Removal requires --yes");
      const index = find(options.positional[0]);
      if (index < 0) throw new Error("Job not found");
      const [removed] = config.cron.jobs.splice(index, 1);
      vito.saveConfig(x, config);
      db.prepare("DELETE FROM job_schedule_state WHERE name = ?").run(removed?.name);
      print({ removed: removed?.name }, options.json);
      return 0;
    }

    if (command === "run") {
      if (options.positional.length !== 1) throw new Error("Usage: vito jobs run NAME");
      const existing = config.cron.jobs[find(options.positional[0])];
      if (!existing) throw new Error("Job not found");
      if (!isScriptJob(existing)) throw new Error("Convert this legacy job first");
      const run = await xJobService(x).execute(
        x,
        { ...existing, delivery: undefined },
        new Date().toISOString(),
      );
      if (!run) throw new Error("Job is already running");
      print(run, options.json);
      return run.state === "completed" || run.state === "skipped" ? 0 : 1;
    }

    if (command === "cancel") {
      if (options.positional.length !== 1) throw new Error("Usage: vito jobs cancel RUN_ID");
      const cancelled = xJobService(x).cancel(x, options.positional[0]);
      print({ id: options.positional[0], cancelled }, options.json);
      return cancelled ? 0 : 1;
    }

    if (command === "history") {
      if (options.positional.length > 1) throw new Error("Usage: vito jobs history [NAME]");
      print(
        xJobService(x).runs(x, { name: options.positional[0], limit: options.limit }),
        options.json,
      );
      return 0;
    }

    if (command === "logs") {
      if (options.positional.length !== 1) throw new Error("Usage: vito jobs logs NAME");
      const path = join(options.userDir, "logs", "jobs", `${basename(options.positional[0])}.log`);
      if (!existsSync(path)) throw new Error("No log exists for this job");
      const content = readFileSync(path, "utf-8");
      const bounded = content.slice(-1024 * 1024);
      if (options.json) print({ name: options.positional[0], log: bounded }, true);
      else process.stdout.write(bounded);
      return 0;
    }

    if (command === "convert") {
      if (
        (!options.all && options.positional.length !== 1) ||
        (options.all && options.positional.length)
      ) {
        throw new Error("Usage: vito jobs convert NAME | vito jobs convert --all");
      }
      const converted: ScriptJobConfig[] = [];
      config.cron.jobs = config.cron.jobs.map((job) => {
        if (isScriptJob(job) || (!options.all && job.name !== options.positional[0])) return job;
        const next = convertLegacy(job, options.userDir);
        converted.push(next);
        return next;
      });
      if (!options.all && converted.length === 0) throw new Error("Legacy job not found");
      vito.saveConfig(x, config);
      print(converted, options.json);
      return 0;
    }

    console.error(`Unknown jobs command: ${command}`);
    process.stderr.write(help);
    return 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    db.close();
  }
}
