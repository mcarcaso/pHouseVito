#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAppsCommand } from "./commands/apps.js";
import { runConfigCommand } from "./commands/config.js";
import { runMemoryCommand } from "./commands/memory.js";
import { runSecretsCommand } from "./commands/secrets.js";
import { runJobsCommand } from "./commands/jobs.js";
import { runUpdateCommand } from "./commands/update.js";
import { runImportVitoNextCommand } from "./commands/import-vito-next.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const help = `Usage: vito <command>

Commands:
  config      Validate Vito configuration
  apps        Create and manage Vito apps
  memory      Search Vito's long-term memory
  secrets     Safely manage secret configuration
  jobs        Manage script-first scheduled jobs
  update      Check, stage, and apply approved signed binary releases
  import-vito-next  Import a quiesced Vito Next snapshot
  help        Show this help

Run "vito <command> --help" for command-specific help.
`;

export async function runCli(args: string[]): Promise<number> {
  const [command, ...commandArgs] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(help);
    return 0;
  }
  if (command === "config") return runConfigCommand(commandArgs, projectRoot);
  if (command === "apps") return runAppsCommand(commandArgs, projectRoot);
  if (command === "memory") return runMemoryCommand(commandArgs, projectRoot);
  if (command === "secrets") return runSecretsCommand(commandArgs, projectRoot);
  if (command === "jobs") return runJobsCommand(commandArgs, projectRoot);
  if (command === "update") return runUpdateCommand(commandArgs, projectRoot);
  if (command === "import-vito-next") return runImportVitoNextCommand(commandArgs, projectRoot);

  console.error(`Unknown command: ${command}`);
  process.stderr.write(help);
  return 2;
}

process.exitCode = await runCli(process.argv.slice(2));
