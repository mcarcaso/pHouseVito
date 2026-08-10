import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import { xPiAuthPath, xSecretsPath } from "../../lib/x.js";
import type {
  PiAuthEntry,
  ProviderApiKeyInfo,
  ProviderAuthStatus,
  SecretEntry,
  SecretService,
} from "./SecretService.js";
import { SystemSecretDeletionError } from "./SecretService.js";

const secretRecordSchema = z.record(z.string());
const secretKeySchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const piAuthEntrySchema = z
  .object({
    type: z.string(),
    access: z.string().optional(),
    refresh: z.string().optional(),
    expires: z.number().optional(),
    key: z.string().optional(),
  })
  .passthrough();
const piAuthSchema = z.record(piAuthEntrySchema);

const PROVIDER_API_KEYS: Record<string, ProviderApiKeyInfo> = {
  anthropic: {
    envVar: "ANTHROPIC_API_KEY",
    description: "Anthropic API key — https://console.anthropic.com/account/keys",
  },
  openai: {
    envVar: "OPENAI_API_KEY",
    description: "OpenAI API key — https://platform.openai.com/api-keys",
  },
  google: {
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    description: "Google AI API key — https://aistudio.google.com/app/apikey",
  },
  groq: {
    envVar: "GROQ_API_KEY",
    description: "Groq API key — https://console.groq.com/keys",
  },
  xai: {
    envVar: "XAI_API_KEY",
    description: "xAI (Grok) API key — https://console.x.ai/",
  },
  openrouter: {
    envVar: "OPENROUTER_API_KEY",
    description: "OpenRouter API key — https://openrouter.ai/keys",
  },
};

const SYSTEM_KEYS: Record<string, string> = {
  TELEGRAM_BOT_TOKEN:
    "Telegram Bot API token — get from @BotFather (required for Telegram channel)",
  DISCORD_BOT_TOKEN:
    "Discord Bot token — get from https://discord.com/developers/applications (required for Discord channel)",
  DASHBOARD_PASSWORD_HASH: "Dashboard password hash (managed automatically — do not edit manually)",
  BLAND_WEBHOOK_SECRET: "Bland AI webhook secret — add as ?secret=VALUE to your Bland webhook URL",
  ...Object.fromEntries(
    Object.values(PROVIDER_API_KEYS).map((provider) => [provider.envVar, provider.description]),
  ),
};

export class FileSecretService implements SecretService {
  private readonly loadedKeys = new Set<string>();

  private readSecretsResult(x: Context): {
    secrets: Record<string, string>;
    valid: boolean;
  } {
    const path = xSecretsPath(x);
    if (!existsSync(path)) return { secrets: {}, valid: true };
    try {
      return {
        secrets: secretRecordSchema.parse(JSON.parse(readFileSync(path, "utf-8"))),
        valid: true,
      };
    } catch {
      console.error(`Failed to parse secrets file ${path} — returning empty`);
      return { secrets: {}, valid: false };
    }
  }

  private readSecrets(x: Context): Record<string, string> {
    return this.readSecretsResult(x).secrets;
  }

  private writeSecrets(x: Context, secrets: Record<string, string>): void {
    const path = xSecretsPath(x);
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(temporaryPath, `${JSON.stringify(secrets, null, 2)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  }

  load(x: Context): void {
    const path = xSecretsPath(x);
    const existed = existsSync(path);
    const result = this.readSecretsResult(x);
    if (existed && !result.valid) return;
    const secrets = result.secrets;
    let updated = false;

    for (const key of Object.keys(SYSTEM_KEYS)) {
      if (!(key in secrets) && process.env[key]) {
        secrets[key] = process.env[key];
        updated = true;
      }
    }
    if (updated || !existed) {
      this.writeSecrets(x, secrets);
      console.log(`Secrets file updated with ${Object.keys(secrets).length} key(s)`);
    }

    for (const key of this.loadedKeys) {
      if (!(key in secrets)) delete process.env[key];
    }
    this.loadedKeys.clear();
    for (const [key, value] of Object.entries(secrets)) {
      if (value) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
      this.loadedKeys.add(key);
    }
    console.log(`Loaded ${Object.keys(secrets).length} secret(s) from ${path}`);
  }

  get(x: Context, key: string): string | undefined {
    return this.readSecrets(x)[key];
  }

  list(x: Context): SecretEntry[] {
    const secrets = this.readSecrets(x);
    const entries: SecretEntry[] = Object.entries(SYSTEM_KEYS).map(([key, description]) => ({
      key,
      value: secrets[key] ?? "",
      system: true,
      description,
    }));
    for (const [key, value] of Object.entries(secrets)) {
      if (key in SYSTEM_KEYS) continue;
      entries.push({ key, value, system: false });
    }
    return entries;
  }

  set(x: Context, args: { key: string; value: string }): SecretEntry {
    const key = secretKeySchema.parse(args.key);
    const result = this.readSecretsResult(x);
    if (!result.valid) throw new Error("Cannot update an invalid secrets file");
    const secrets = result.secrets;
    secrets[key] = args.value;
    this.writeSecrets(x, secrets);
    if (args.value) process.env[key] = args.value;
    else delete process.env[key];
    this.loadedKeys.add(key);
    return {
      key,
      value: args.value,
      system: key in SYSTEM_KEYS,
      description: SYSTEM_KEYS[key],
    };
  }

  delete(x: Context, args: { key: string }): boolean {
    const key = secretKeySchema.parse(args.key);
    if (key in SYSTEM_KEYS) throw new SystemSecretDeletionError(key);
    const result = this.readSecretsResult(x);
    if (!result.valid) throw new Error("Cannot update an invalid secrets file");
    const secrets = result.secrets;
    const existed = key in secrets;
    delete secrets[key];
    this.writeSecrets(x, secrets);
    delete process.env[key];
    this.loadedKeys.delete(key);
    return existed;
  }

  getProviderApiKeyInfo(_x: Context): Record<string, ProviderApiKeyInfo> {
    return { ...PROVIDER_API_KEYS };
  }

  getPiAuth(x: Context): Record<string, PiAuthEntry> {
    const path = xPiAuthPath(x);
    if (!existsSync(path)) return {};
    try {
      return piAuthSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
    } catch {
      return {};
    }
  }

  getProviderAuthStatus(x: Context): Record<string, ProviderAuthStatus> {
    const secrets = this.readSecrets(x);
    const piAuth = this.getPiAuth(x);
    const status: Record<string, ProviderAuthStatus> = {};

    for (const [provider, config] of Object.entries(PROVIDER_API_KEYS)) {
      const apiKey = secrets[config.envVar] || process.env[config.envVar];
      const hasApiKey = Boolean(apiKey?.trim());
      const oauthEntry = piAuth[provider];
      const hasOAuth = Boolean(oauthEntry?.type === "oauth" && oauthEntry.access);
      if (hasApiKey) {
        status[provider] = { hasAuth: true, authType: "api_key" };
      } else if (hasOAuth) {
        status[provider] = {
          hasAuth: true,
          authType: "oauth",
          expiresAt: oauthEntry?.expires,
        };
      } else {
        status[provider] = { hasAuth: false, authType: null };
      }
    }

    for (const [provider, entry] of Object.entries(piAuth)) {
      if (status[provider]) continue;
      if (entry.type === "oauth" && entry.access) {
        status[provider] = {
          hasAuth: true,
          authType: "oauth",
          expiresAt: entry.expires,
        };
      } else if (entry.type === "api_key" && entry.key) {
        status[provider] = { hasAuth: true, authType: "api_key" };
      }
    }
    return status;
  }

  getProviderKeyStatus(x: Context): Record<string, boolean> {
    return Object.fromEntries(
      Object.entries(this.getProviderAuthStatus(x)).map(([provider, status]) => [
        provider,
        status.hasAuth,
      ]),
    );
  }
}
