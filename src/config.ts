import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { VitoConfig } from "./types.js";

const ROOT = process.cwd();

export function loadConfig(): VitoConfig {
  const configPath = resolve(ROOT, "vito.config.json");
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as VitoConfig;
}

export function loadSoul(): string {
  const soulPath = resolve(ROOT, "SOUL.md");
  if (!existsSync(soulPath)) {
    return "";
  }
  return readFileSync(soulPath, "utf-8");
}
