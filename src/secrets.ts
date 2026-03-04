import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { USER_DIR } from "./config.js";

export const SECRETS_PATH = resolve(USER_DIR, "secrets.json");
export const PI_AUTH_PATH = resolve(homedir(), ".pi/agent/auth.json");

// System keys that always appear in the dashboard (with descriptions)
export const SYSTEM_KEYS: Record<string, string> = {
  // Channel tokens
  TELEGRAM_BOT_TOKEN: "Telegram Bot API token — get from @BotFather (required for Telegram channel)",
  DISCORD_BOT_TOKEN: "Discord Bot token — get from https://discord.com/developers/applications (required for Discord channel)",
  // Provider API keys (auto-populated from PROVIDER_API_KEYS below)
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
  openrouter: { 
    envVar: "OPENROUTER_API_KEY", 
    description: "OpenRouter API key — https://openrouter.ai/keys" 
  },
};

// Add provider keys to system keys for dashboard visibility
for (const config of Object.values(PROVIDER_API_KEYS)) {
  SYSTEM_KEYS[config.envVar] = config.description;
}

/** Read Pi's OAuth auth.json for provider tokens */
function readPiAuth(): Record<string, { type: string; access?: string; refresh?: string; expires?: number }> {
  if (!existsSync(PI_AUTH_PATH)) return {};
  try {
    return JSON.parse(readFileSync(PI_AUTH_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export type AuthType = "api_key" | "oauth" | null;

export interface ProviderAuthStatus {
  hasAuth: boolean;
  authType: AuthType;
  expiresAt?: number; // For OAuth tokens
}

/** Check which providers have valid API keys or OAuth tokens configured */
export function getProviderKeyStatus(): Record<string, boolean> {
  const detailed = getProviderAuthStatus();
  const status: Record<string, boolean> = {};
  for (const [provider, info] of Object.entries(detailed)) {
    status[provider] = info.hasAuth;
  }
  return status;
}

/** Get detailed auth status for each provider (API key vs OAuth) */
export function getProviderAuthStatus(): Record<string, ProviderAuthStatus> {
  const secrets = readSecrets();
  const piAuth = readPiAuth();
  const status: Record<string, ProviderAuthStatus> = {};
  
  for (const [provider, config] of Object.entries(PROVIDER_API_KEYS)) {
    // Check secrets.json first, then fall back to process.env
    const apiKey = secrets[config.envVar] || process.env[config.envVar];
    const hasApiKey = Boolean(apiKey && apiKey.trim().length > 0);
    
    // Also check Pi's OAuth auth.json for this provider
    const oauthEntry = piAuth[provider];
    const hasOAuth = Boolean(oauthEntry && oauthEntry.type === "oauth" && oauthEntry.access);
    
    if (hasApiKey) {
      status[provider] = { hasAuth: true, authType: "api_key" };
    } else if (hasOAuth) {
      status[provider] = { 
        hasAuth: true, 
        authType: "oauth",
        expiresAt: oauthEntry?.expires
      };
    } else {
      status[provider] = { hasAuth: false, authType: null };
    }
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
  const existing = existsSync(SECRETS_PATH) ? readSecrets() : {};
  let updated = false;

  // Seed any missing system keys from env
  for (const key of Object.keys(SYSTEM_KEYS)) {
    if (!(key in existing) && process.env[key]) {
      existing[key] = process.env[key]!;
      updated = true;
    }
  }

  // Write if we added new keys
  if (updated || !existsSync(SECRETS_PATH)) {
    writeSecrets(existing);
    console.log(`secrets.json updated with ${Object.keys(existing).length} key(s)`);
  }

  // Load into process.env
  for (const [key, value] of Object.entries(existing)) {
    if (value) process.env[key] = value;
  }
  console.log(`Loaded ${Object.keys(existing).length} secret(s) from secrets.json`);
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
