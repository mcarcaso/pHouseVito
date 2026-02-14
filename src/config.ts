import { readFileSync, existsSync, cpSync } from "fs";
import { resolve } from "path";
import type { VitoConfig } from "./types.js";

const ROOT = process.cwd();
export const USER_DIR = resolve(ROOT, "user");

/** Copy user.example/ to user/ if it doesn't exist yet */
export function ensureUserDir(): void {
  if (!existsSync(USER_DIR)) {
    const exampleDir = resolve(ROOT, "user.example");
    if (!existsSync(exampleDir)) {
      throw new Error("user.example/ directory not found — is the repo intact?");
    }
    cpSync(exampleDir, USER_DIR, { recursive: true });
    console.log("Created user/ directory from template");
  }
}

export function loadConfig(): VitoConfig {
  const configPath = resolve(USER_DIR, "vito.config.json");
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as VitoConfig;
}

export function loadSoul(): string {
  const soulPath = resolve(USER_DIR, "SOUL.md");
  if (!existsSync(soulPath)) {
    return "";
  }
  return readFileSync(soulPath, "utf-8");
}
