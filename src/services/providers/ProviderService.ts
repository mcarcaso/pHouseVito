import type { Context } from "../../context/Context.js";
import type { ProviderApiKeyInfo, ProviderAuthStatus } from "../secrets/SecretService.js";

export interface ProviderOverview {
  providers: unknown[];
  keyStatus: Record<string, boolean>;
  authStatus: Record<string, ProviderAuthStatus>;
  keyInfo: Record<string, ProviderApiKeyInfo>;
  oauthProviders: { id: string; name: string }[];
}

export type ProviderLoginStartResult =
  | { status: "already_authenticated" }
  | { status: "login_started"; url: string; instructions?: string }
  | {
      status: "device_code_started";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    };

export type ProviderLoginStatus =
  | { status: "none" | "pending" | "success" }
  | { status: "prompt"; promptMessage: string }
  | { status: "error"; error: string };

export class ProviderLoginConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderLoginConflictError";
  }
}

export interface ProviderService {
  getOverview(x: Context): ProviderOverview;
  listModels(x: Context, providerId: string): { id: string }[];
  startLogin(x: Context, providerId: string): Promise<ProviderLoginStartResult>;
  getLoginStatus(x: Context, providerId: string): ProviderLoginStatus;
  submitPrompt(x: Context, args: { providerId: string; value: string }): void;
  logout(x: Context, providerId: string): void;
}
