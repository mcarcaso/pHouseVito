import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export const USER_DIR = resolve(process.cwd(), "user");

/** Copy user.example/ to user/ on first run. */
export function ensureUserDir(): void {
  if (existsSync(USER_DIR)) return;

  const exampleDir = resolve(process.cwd(), "user.example");
  if (!existsSync(exampleDir)) {
    throw new Error("user.example/ directory not found — is the repo intact?");
  }
  cpSync(exampleDir, USER_DIR, { recursive: true });
  console.log("Created user/ directory from template");
}
