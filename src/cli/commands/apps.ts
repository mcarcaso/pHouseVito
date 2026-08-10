import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Compatibility adapter for the existing app-management CLI. App publication
 * will move behind the constrained gateway described in to-do.md.
 */
export function runAppsCommand(args: string[], projectRoot: string): number {
  const [command] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(
      `Usage: vito apps <command> [options]\n\nCommands:\n  create    Create or update an app\n  list      List apps\n  delete    Delete an app\n`,
    );
    return 0;
  }
  const scriptPath = resolve(projectRoot, "skills", "builtin", "apps", "index.js");
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Unable to run apps command: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}
