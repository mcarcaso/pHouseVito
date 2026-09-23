import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { ObjectContext } from "../../context/ObjectContext.js";
import { FileSecretService } from "../../services/secrets/FileSecretService.js";
import { SystemSecretDeletionError } from "../../services/secrets/SecretService.js";

const secretsHelp = `Usage: vito secrets <command> [options]

Commands:
  list                     List names and configured status
  status                   Alias for list
  set KEY [--stdin]        Set a secret (hidden prompt by default)
  remove KEY [--yes]       Remove a custom secret

Options:
  --json                   Print stable JSON output
  --stdin                  Read a value from standard input
  --yes                    Confirm non-interactive removal
  --file PATH              Use an explicit secrets file
  -h, --help               Show this help

Secret values are never printed. There is no get/show-value command.
`;

interface ParsedOptions {
  positional: string[];
  json: boolean;
  stdin: boolean;
  yes: boolean;
  file?: string;
}

function parseOptions(args: string[]): ParsedOptions {
  const parsed: ParsedOptions = { positional: [], json: false, stdin: false, yes: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json") parsed.json = true;
    else if (arg === "--stdin") parsed.stdin = true;
    else if (arg === "--yes") parsed.yes = true;
    else if (arg === "--file") {
      const path = args[++index];
      if (!path) throw new Error("--file requires a path");
      parsed.file = resolve(process.cwd(), path);
    } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else parsed.positional.push(arg);
  }
  return parsed;
}

function readStdin(): string {
  const input = readFileSync(0, "utf-8");
  return input.endsWith("\n") ? input.slice(0, -1).replace(/\r$/, "") : input;
}

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error("A terminal is required for hidden input; use --stdin for automation");
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  try {
    return await new Promise<string>((resolveValue, reject) => {
      const onData = (chunk: Buffer) => {
        for (const byte of chunk) {
          if (byte === 3) {
            process.stdin.off("data", onData);
            reject(new Error("Secret entry cancelled"));
            return;
          }
          if (byte === 13 || byte === 10) {
            process.stdin.off("data", onData);
            resolveValue(value);
            return;
          }
          if (byte === 8 || byte === 127) {
            value = value.slice(0, -1);
            continue;
          }
          value += Buffer.from([byte]).toString("utf-8");
        }
      };
      process.stdin.on("data", onData);
    });
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write("\n");
  }
}

async function confirmRemoval(key: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error("Removal requires --yes when input is non-interactive");
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(`Remove ${key}? Type the key to confirm: `);
    return answer.trim() === key;
  } finally {
    readline.close();
  }
}

function printResult(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value as Array<{ key: string; configured: boolean; system: boolean }>) {
      process.stdout.write(
        `${entry.configured ? "configured" : "not configured"}\t${entry.system ? "system" : "custom"}\t${entry.key}\n`,
      );
    }
  }
}

export async function runSecretsCommand(args: string[], projectRoot: string): Promise<number> {
  const [command, ...optionArgs] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(secretsHelp);
    return 0;
  }

  let options: ParsedOptions;
  try {
    options = parseOptions(optionArgs);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const secretsPath =
    options.file ?? process.env.VITO_SECRETS_PATH ?? resolve(projectRoot, "user", "secrets.json");
  const x = new ObjectContext({
    secretsPath: () => secretsPath,
    piAuthPath: () => resolve(projectRoot, "user", ".unused-pi-auth.json"),
  });
  const service = new FileSecretService();

  try {
    if (command === "list" || command === "status") {
      if (options.positional.length > 0 || options.stdin || options.yes) {
        throw new Error(`secrets ${command} does not accept those arguments`);
      }
      const entries = service.list(x);
      printResult(entries, options.json);
      return 0;
    }

    if (command === "set") {
      if (options.positional.length !== 1 || options.yes) {
        throw new Error("Usage: vito secrets set KEY [--stdin] [--json] [--file PATH]");
      }
      const value = options.stdin ? readStdin() : await readHidden("Secret value: ");
      if (!value) throw new Error("Secret value cannot be empty");
      const entry = service.set(x, { key: options.positional[0], value });
      const result = { key: entry.key, configured: entry.configured, system: entry.system };
      if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
      else process.stdout.write(`Configured ${entry.key}\n`);
      return 0;
    }

    if (command === "remove") {
      if (options.positional.length !== 1 || options.stdin) {
        throw new Error("Usage: vito secrets remove KEY [--yes] [--json] [--file PATH]");
      }
      const key = options.positional[0];
      const confirmed = options.yes || (await confirmRemoval(key));
      if (!confirmed) {
        console.error("Removal not confirmed");
        return 1;
      }
      const removed = service.delete(x, { key });
      const result = { key, removed };
      if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
      else process.stdout.write(removed ? `Removed ${key}\n` : `${key} was not configured\n`);
      return 0;
    }

    console.error(`Unknown secrets command: ${command}`);
    process.stderr.write(secretsHelp);
    return 2;
  } catch (error) {
    if (error instanceof SystemSecretDeletionError) {
      console.error("System secrets cannot be removed; replace or clear them through settings");
      return 1;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
