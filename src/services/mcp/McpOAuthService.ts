import type { Context } from "../../context/Context.js";
import type { AuthProvider } from "@earendil-works/pi-mcp";
export interface McpOAuthStatus {
  status: "none" | "pending" | "connected" | "error";
  expiresAt?: number;
  message?: string;
}
export interface McpOAuthService {
  clientMetadata(x: Context): Record<string, unknown>;
  status(x: Context, name: string): McpOAuthStatus;
  start(x: Context, name: string): Promise<{ url: string; callbackUrl: string }>;
  finish(x: Context, input: { state: string; code?: string; error?: string }): Promise<boolean>;
  disconnect(x: Context, name: string): void;
  nativeProvider(x: Context, name: string): AuthProvider;
  revision(x: Context): string;
}
