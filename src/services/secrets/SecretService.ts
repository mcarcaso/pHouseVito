import type { Context } from "../../context/Context.js";

export type AuthType = "api_key" | "oauth" | null;

export interface ProviderAuthStatus {
  hasAuth: boolean;
  authType: AuthType;
  expiresAt?: number;
}

export interface PiAuthEntry {
  type: string;
  access?: string;
  refresh?: string;
  expires?: number;
  key?: string;
}

export interface SecretEntry {
  key: string;
  value: string;
  system: boolean;
  description?: string;
}

export interface ProviderApiKeyInfo {
  envVar: string;
  description: string;
}

export class SystemSecretDeletionError extends Error {
  constructor(key: string) {
    super(`Cannot delete system secret: ${key}`);
    this.name = "SystemSecretDeletionError";
  }
}

export interface SecretService {
  load(x: Context): void;
  get(x: Context, key: string): string | undefined;
  list(x: Context): SecretEntry[];
  set(x: Context, args: { key: string; value: string }): SecretEntry;
  delete(x: Context, args: { key: string }): boolean;
  getProviderApiKeyInfo(x: Context): Record<string, ProviderApiKeyInfo>;
  getProviderKeyStatus(x: Context): Record<string, boolean>;
  getProviderAuthStatus(x: Context): Record<string, ProviderAuthStatus>;
  getPiAuth(x: Context): Record<string, PiAuthEntry>;
}
