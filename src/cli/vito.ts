#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAppsCommand } from "./commands/apps.js";
import { runConfigCommand } from "./commands/config.js";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const help = `Usage: vito <command>

Commands:
  config      Validate Vito configuration
  apps        Create and manage Vito apps
  help        Show this help

Run "vito <command> --help" for command-specific help.
`;

export function runCli(args: string[]): number {
  const [command, ...commandArgs] = args;
  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    process.stdout.write(help);
    return 0;
  }
  if (command === "config") return runConfigCommand(commandArgs, projectRoot);
  if (command === "apps") return runAppsCommand(commandArgs, projectRoot);

  console.error(`Unknown command: ${command}`);
  process.stderr.write(help);
  return 2;
}

process.exitCode = runCli(process.argv.slice(2));
