import { readFileSync, existsSync, cpSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { VitoConfig } from "./types.js";
import { getWorkspace } from "./workspace.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = process.cwd();

// USER_DIR is now dynamic based on workspace
// IMPORTANT: This is evaluated at module load time. For dynamic workspace support,
// use getUserDir() instead which reads VITO_WORKSPACE env var each time.
export function getUserDir(): string {
  return getWorkspace();
}

// For backwards compatibility — but NOTE: this is evaluated ONCE at import time.
// If VITO_WORKSPACE changes after import, this won't reflect it.
// Most code should use getUserDir() for dynamic resolution.
export let USER_DIR = getUserDir();

// Allow re-initialization (called after env vars are set up)
export function reinitUserDir(): void {
  USER_DIR = getUserDir();
}

/** Copy user.example/ or templates/workspace/ to workspace if it doesn't exist yet */
export function ensureUserDir(): void {
  const workspace = getUserDir();
  
  if (!existsSync(workspace)) {
    // First, try templates/workspace/ (npm package location)
    const templatesDir = resolve(__dirname, "..", "templates", "workspace");
    // Then try user.example/ (dev location)
    const exampleDir = resolve(ROOT, "user.example");
    
    let sourceDir: string | null = null;
    if (existsSync(templatesDir)) {
      sourceDir = templatesDir;
    } else if (existsSync(exampleDir)) {
      sourceDir = exampleDir;
    }
    
    if (sourceDir) {
      cpSync(sourceDir, workspace, { recursive: true });
      console.log(`Created workspace at ${workspace} from template`);
    } else {
      // Create minimal workspace
      mkdirSync(workspace, { recursive: true });
      console.log(`Created empty workspace at ${workspace}`);
    }
  }
}

export function loadConfig(): VitoConfig {
  const configPath = resolve(getUserDir(), "config.json");
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = readFileSync(configPath, "utf-8");
  return JSON.parse(raw) as VitoConfig;
}

export function loadSoul(): string {
  const soulPath = resolve(getUserDir(), "SOUL.md");
  if (!existsSync(soulPath)) {
    return "";
  }
  return readFileSync(soulPath, "utf-8");
}
