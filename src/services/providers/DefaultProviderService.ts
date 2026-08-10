import { getModels, getProviders } from "@earendil-works/pi-ai/compat";
import { getOAuthProviders } from "@earendil-works/pi-ai/oauth";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import { xSecretService } from "../../lib/x.js";
import type {
  ProviderLoginStartResult,
  ProviderLoginStatus,
  ProviderOverview,
  ProviderService,
} from "./ProviderService.js";
import { ProviderLoginConflictError } from "./ProviderService.js";

interface PendingLogin {
  status: "pending" | "prompt" | "success" | "error";
  error?: string;
  promptMessage?: string;
  resolvePrompt?: (value: string) => void;
}

const providerListSchema = z.array(z.unknown());
const modelListSchema = z.array(z.object({ id: z.string() }).passthrough());
const oauthProviderListSchema = z.array(
  z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .passthrough(),
);

export class DefaultProviderService implements ProviderService {
  private readonly pendingLogins = new Map<string, PendingLogin>();

  getOverview(x: Context): ProviderOverview {
    const secrets = xSecretService(x);
    return {
      providers: providerListSchema.parse(getProviders()),
      keyStatus: secrets.getProviderKeyStatus(x),
      authStatus: secrets.getProviderAuthStatus(x),
      keyInfo: secrets.getProviderApiKeyInfo(x),
      oauthProviders: oauthProviderListSchema
        .parse(getOAuthProviders())
        .map((provider) => ({ id: provider.id, name: provider.name })),
    };
  }

  listModels(_x: Context, providerId: string): { id: string }[] {
    const providers = getProviders();
    const provider = providers.find((candidate) => candidate === providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    return modelListSchema.parse(getModels(provider)).map((model) => ({ id: model.id }));
  }

  async startLogin(x: Context, providerId: string): Promise<ProviderLoginStartResult> {
    const piAuth = xSecretService(x).getPiAuth(x);
    if (piAuth[providerId]?.type === "oauth" && piAuth[providerId]?.access) {
      return { status: "already_authenticated" };
    }

    const existing = this.pendingLogins.get(providerId);
    if (existing?.status === "pending" || existing?.status === "prompt") {
      throw new ProviderLoginConflictError("Login already in progress");
    }
    this.pendingLogins.set(providerId, { status: "pending" });

    return await new Promise<ProviderLoginStartResult>((resolve, reject) => {
      let responseSettled = false;
      const resolveOnce = (result: ProviderLoginStartResult): void => {
        if (responseSettled) return;
        responseSettled = true;
        resolve(result);
      };
      const rejectOnce = (error: Error): void => {
        if (responseSettled) return;
        responseSettled = true;
        reject(error);
      };

      const authStorage = AuthStorage.create();
      const callbacks = {
        onAuth: (info: { url: string; instructions?: string }) => {
          resolveOnce({
            status: "login_started",
            url: info.url,
            instructions: info.instructions,
          });
        },
        onDeviceCode: (info: {
          userCode: string;
          verificationUri: string;
          intervalSeconds?: number;
          expiresInSeconds?: number;
        }) => {
          resolveOnce({
            status: "device_code_started",
            userCode: info.userCode,
            verificationUri: info.verificationUri,
            intervalSeconds: info.intervalSeconds,
            expiresInSeconds: info.expiresInSeconds,
          });
        },
        onSelect: async (info: { options: Array<{ id: string; label: string }> }) => {
          const deviceOption = info.options.find((option) =>
            /device|code/i.test(`${option.id} ${option.label}`),
          );
          return deviceOption?.id ?? info.options[0]?.id;
        },
        onPrompt: async (info: { message: string }) =>
          await this.waitForPrompt(providerId, info.message),
        onManualCodeInput: async () =>
          await this.waitForPrompt(
            providerId,
            "After the browser redirects to localhost, copy the full redirected URL and paste it here:",
          ),
        onProgress: (message: string) => {
          console.log(`[oauth/${providerId}] ${message}`);
        },
      };

      authStorage
        .login(providerId, callbacks)
        .then(() => {
          this.pendingLogins.set(providerId, { status: "success" });
          console.log(`[oauth/${providerId}] Login successful`);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.pendingLogins.set(providerId, { status: "error", error: message });
          console.error(`[oauth/${providerId}] Login failed:`, message);
          rejectOnce(error instanceof Error ? error : new Error(message));
        });
    });
  }

  getLoginStatus(x: Context, providerId: string): ProviderLoginStatus {
    const pending = this.pendingLogins.get(providerId);
    if (!pending) {
      const auth = xSecretService(x).getPiAuth(x)[providerId];
      return auth?.type === "oauth" && auth.access ? { status: "success" } : { status: "none" };
    }

    const result: ProviderLoginStatus =
      pending.status === "prompt"
        ? { status: "prompt", promptMessage: pending.promptMessage ?? "" }
        : pending.status === "error"
          ? { status: "error", error: pending.error ?? "Unknown login error" }
          : { status: pending.status };
    if (pending.status !== "pending" && pending.status !== "prompt") {
      this.pendingLogins.delete(providerId);
    }
    return result;
  }

  submitPrompt(_x: Context, args: { providerId: string; value: string }): void {
    const pending = this.pendingLogins.get(args.providerId);
    if (!pending || pending.status !== "prompt" || !pending.resolvePrompt) {
      throw new ProviderLoginConflictError("No login prompt is waiting for this provider");
    }
    pending.resolvePrompt(args.value);
    this.pendingLogins.set(args.providerId, { status: "pending" });
  }

  logout(_x: Context, providerId: string): void {
    AuthStorage.create().logout(providerId);
  }

  private async waitForPrompt(providerId: string, promptMessage: string): Promise<string> {
    return await new Promise<string>((resolve) => {
      this.pendingLogins.set(providerId, {
        status: "prompt",
        promptMessage,
        resolvePrompt: resolve,
      });
    });
  }
}
