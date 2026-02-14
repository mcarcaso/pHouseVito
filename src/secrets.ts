import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { USER_DIR } from "./config.js";

export const SECRETS_PATH = resolve(USER_DIR, "secrets.json");

// System keys that always appear in the dashboard (with descriptions)
export const SYSTEM_KEYS: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: "Telegram Bot API token — get from @BotFather (required for Telegram channel)",
  DISCORD_BOT_TOKEN: "Discord Bot token — get from https://discord.com/developers/applications (required for Discord channel)",
};

// Provider API keys — these map to AI model providers
export const PROVIDER_API_KEYS: Record<string, { envVar: string; description: string }> = {
  anthropic: { 
    envVar: "ANTHROPIC_API_KEY", 
    description: "Anthropic API key — https://console.anthropic.com/account/keys" 
  },
  openai: { 
    envVar: "OPENAI_API_KEY", 
    description: "OpenAI API key — https://platform.openai.com/api-keys" 
  },
  google: { 
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY", 
    description: "Google AI API key — https://aistudio.google.com/app/apikey" 
  },
  groq: { 
    envVar: "GROQ_API_KEY", 
    description: "Groq API key — https://console.groq.com/keys" 
  },
  xai: { 
    envVar: "XAI_API_KEY", 
    description: "xAI (Grok) API key — https://console.x.ai/" 
  },
};

/** Check which providers have valid API keys configured */
export function getProviderKeyStatus(): Record<string, boolean> {
  const secrets = readSecrets();
  const status: Record<string, boolean> = {};
  
  for (const [provider, config] of Object.entries(PROVIDER_API_KEYS)) {
    // Check secrets.json first, then fall back to process.env
    const value = secrets[config.envVar] || process.env[config.envVar];
    status[provider] = Boolean(value && value.trim().length > 0);
  }
  
  return status;
}

export interface SecretEntry {
  key: string;
  value: string;
  system?: boolean;
  description?: string;
}

/** Read secrets.json → flat Record<string, string> */
export function readSecrets(): Record<string, string> {
  if (!existsSync(SECRETS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SECRETS_PATH, "utf-8"));
  } catch {
    console.error("Failed to parse secrets.json — returning empty");
    return {};
  }
}

/** Write flat Record<string, string> → secrets.json */
export function writeSecrets(secrets: Record<string, string>): void {
  writeFileSync(SECRETS_PATH, JSON.stringify(secrets, null, 2) + "\n", "utf-8");
}

/** Load secrets.json into process.env (override existing) */
export function loadSecrets(): void {
  if (!existsSync(SECRETS_PATH)) {
    // Seed with system keys from env (first run migration)
    const seed: Record<string, string> = {};
    for (const key of Object.keys(SYSTEM_KEYS)) {
      seed[key] = process.env[key] || "";
    }
    writeSecrets(seed);
    console.log(`secrets.json created with ${Object.keys(seed).length} key(s)`);
  }

  const secrets = readSecrets();
  for (const [key, value] of Object.entries(secrets)) {
    process.env[key] = value;
  }
  console.log(`Loaded ${Object.keys(secrets).length} secret(s) from secrets.json`);
}

/** Get secrets formatted for the dashboard API */
export function getSecretsForDashboard(): SecretEntry[] {
  const secrets = readSecrets();
  const results: SecretEntry[] = [];
  const seen = new Set<string>();

  // Add all secrets from file
  for (const [key, value] of Object.entries(secrets)) {
    seen.add(key);
    results.push({
      key,
      value,
      system: key in SYSTEM_KEYS,
      description: SYSTEM_KEYS[key],
    });
  }

  // Append any missing system keys
  for (const [key, description] of Object.entries(SYSTEM_KEYS)) {
    if (!seen.has(key)) {
      results.unshift({ key, value: "", system: true, description });
    }
  }

  return results;
}
