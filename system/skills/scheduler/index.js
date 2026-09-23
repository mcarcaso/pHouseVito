#!/usr/bin/env node
/** Compatibility launcher for the script-first Jobs operator CLI. */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const result = spawnSync(resolve(projectRoot, "vito"), ["jobs", ...process.argv.slice(2)], {
  cwd: projectRoot,
  stdio: "inherit",
});
if (result.error) {
  console.error(result.error.message);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
