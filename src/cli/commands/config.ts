import { resolve } from "node:path";
import { z } from "zod";
import {
  migrateConfigFile,
  printConfigMigration,
  printConfigValidation,
  validateConfigFile,
} from "../config-validation.js";

const validateArgsSchema = z.array(z.string()).max(1);

const configHelp = `Usage: vito config <command>

Commands:
  validate [FILE]   Validate a Vito config (default: user/vito.config.json)
  migrate [FILE]    Atomically rewrite a config to the current schema

Options:
  -h, --help        Show this help
`;

export function runConfigCommand(args: string[], projectRoot: string): number {
  const [command, ...commandArgs] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(configHelp);
    return 0;
  }
  if (command !== "validate" && command !== "migrate") {
    console.error(`Unknown config command: ${command}`);
    process.stderr.write(configHelp);
    return 2;
  }

  const parsed = validateArgsSchema.safeParse(commandArgs);
  if (!parsed.success) {
    console.error(`config ${command} accepts at most one file path`);
    return 2;
  }
  const path = parsed.data[0]
    ? resolve(process.cwd(), parsed.data[0])
    : resolve(projectRoot, "user", "vito.config.json");
  if (command === "migrate") {
    const result = migrateConfigFile(path);
    printConfigMigration(result);
    return result.valid ? 0 : 1;
  }
  const result = validateConfigFile(path);
  printConfigValidation(result);
  return result.valid ? 0 : 1;
}
