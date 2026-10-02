import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import { xPiAuthPath, xSecretService } from "../../lib/x.js";
import type {
  ProviderLoginStartResult,
  ProviderLoginStatus,
  ProviderOverview,
  ProviderService,
} from "./ProviderService.js";
import { modelAutocompleteChoices } from "./model-autocomplete.js";
import { ProviderLoginConflictError } from "./ProviderService.js";

interface PendingLogin {
  controller: AbortController;
  status: "pending" | "prompt" | "success" | "error";
  error?: string;
  promptMessage?: string;
  resolvePrompt?: (value: string) => void;
}

const providerListSchema = z.array(z.string());
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
  private runtime?: Promise<ModelRuntime>;
  private readonly signingOut = new Set<string>();

  async getOverview(x: Context): Promise<ProviderOverview> {
    const secrets = xSecretService(x);
    const providers = (await this.getRuntime(x)).getProviders();
    return {
      providers: providerListSchema.parse(providers.map((provider) => provider.id)),
      keyStatus: secrets.getProviderKeyStatus(x),
      authStatus: secrets.getProviderAuthStatus(x),
      keyInfo: secrets.getProviderApiKeyInfo(x),
      oauthProviders: oauthProviderListSchema
        .parse(
          providers
            .filter((provider) => provider.auth.oauth !== undefined)
            .map((provider) => ({ id: provider.id, name: provider.name })),
        )
        .map((provider) => ({ id: provider.id, name: provider.name })),
    };
  }

  async listModels(x: Context, providerId: string): Promise<{ id: string }[]> {
    const runtime = await this.getRuntime(x);
    if (!runtime.getProvider(providerId)) throw new Error(`Unknown provider: ${providerId}`);
    return modelListSchema.parse(runtime.getModels(providerId)).map((model) => ({ id: model.id }));
  }

  async searchModels(x: Context, query: string): Promise<string[]> {
    const runtime = await this.getRuntime(x);
    const models: string[] = [];
    for (const provider of runtime.getProviders()) {
      for (const model of runtime.getModels(provider.id)) {
        models.push(`${provider.id}/${model.id}`);
      }
    }
    return modelAutocompleteChoices(models, query);
  }

  async startLogin(x: Context, providerId: string): Promise<ProviderLoginStartResult> {
    if (this.signingOut.has(providerId))
      throw new ProviderLoginConflictError("Sign-out in progress");
    const piAuth = xSecretService(x).getPiAuth(x);
    if (piAuth[providerId]?.type === "oauth" && piAuth[providerId]?.access) {
      return { status: "already_authenticated" };
    }

    const existing = this.pendingLogins.get(providerId);
    if (existing?.status === "pending" || existing?.status === "prompt") {
      throw new ProviderLoginConflictError("Login already in progress");
    }
    const pending: PendingLogin = { status: "pending", controller: new AbortController() };
    this.pendingLogins.set(providerId, pending);

    const timeout = setTimeout(
      () => pending.controller.abort(new Error("Login expired; please try again")),
      10 * 60 * 1000,
    );
    timeout.unref();
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

      this.getRuntime(x)
        .then(async (runtime) => {
          const provider = runtime.getProvider(providerId);
          if (!provider?.auth.oauth)
            throw new Error(`Provider does not support OAuth: ${providerId}`);
          pending.controller.signal.throwIfAborted();
          await runtime.login(providerId, "oauth", {
            signal: pending.controller.signal,
            notify: (event) => {
              pending.controller.signal.throwIfAborted();
              this.handleAuthEvent(providerId, event, resolveOnce);
            },
            prompt: async (prompt) => {
              pending.controller.signal.throwIfAborted();
              return await this.handleAuthPrompt(providerId, {
                ...prompt,
                signal: prompt.signal
                  ? AbortSignal.any([prompt.signal, pending.controller.signal])
                  : pending.controller.signal,
              });
            },
          });
          resolveOnce({ status: "already_authenticated" });
          if (this.pendingLogins.get(providerId) === pending) pending.status = "success";
          console.log(`[oauth/${providerId}] Login successful`);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (this.pendingLogins.get(providerId) === pending) {
            pending.status = "error";
            pending.error = message;
          }
          console.error(`[oauth/${providerId}] Login failed:`, message);
          rejectOnce(error instanceof Error ? error : new Error(message));
        })
        .finally(() => clearTimeout(timeout));
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
    pending.status = "pending";
    pending.resolvePrompt = undefined;
  }

  async logout(x: Context, providerId: string): Promise<void> {
    if (this.signingOut.has(providerId))
      throw new ProviderLoginConflictError("Sign-out in progress");
    this.signingOut.add(providerId);
    const pending = this.pendingLogins.get(providerId);
    pending?.controller.abort(new Error("Login cancelled by sign-out"));
    // Keep the entry until logout completes, so a new login cannot race credential removal.
    if (pending) pending.status = "pending";
    try {
      await (await this.getRuntime(x)).logout(providerId);
    } finally {
      this.signingOut.delete(providerId);
      if (this.pendingLogins.get(providerId) === pending) this.pendingLogins.delete(providerId);
    }
  }

  private getRuntime(x: Context): Promise<ModelRuntime> {
    this.runtime ??= ModelRuntime.create({
      authPath: xPiAuthPath(x),
      refreshOnCreate: false,
    });
    return this.runtime;
  }

  private handleAuthEvent(
    providerId: string,
    event: AuthEvent,
    resolveLogin: (result: ProviderLoginStartResult) => void,
  ): void {
    if (event.type === "auth_url") {
      resolveLogin({
        status: "login_started",
        url: event.url,
        instructions: event.instructions,
      });
      return;
    }
    if (event.type === "device_code") {
      resolveLogin({
        status: "device_code_started",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        intervalSeconds: event.intervalSeconds,
        expiresInSeconds: event.expiresInSeconds,
      });
      return;
    }
    console.log(`[oauth/${providerId}] ${event.message}`);
  }

  private async handleAuthPrompt(providerId: string, prompt: AuthPrompt): Promise<string> {
    if (prompt.type === "select") {
      const deviceOption = prompt.options.find((option) =>
        /device|code/i.test(`${option.id} ${option.label}`),
      );
      const selected = deviceOption?.id ?? prompt.options[0]?.id;
      if (!selected) throw new Error(`OAuth provider ${providerId} returned no login options`);
      return selected;
    }
    return await this.waitForPrompt(providerId, prompt.message, prompt.signal);
  }

  private async waitForPrompt(
    providerId: string,
    promptMessage: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const onAbort = (): void => reject(signal?.reason ?? new Error("Login prompt cancelled"));
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      const pending = this.pendingLogins.get(providerId);
      if (!pending) {
        signal?.removeEventListener("abort", onAbort);
        reject(new Error("Login cancelled"));
        return;
      }
      Object.assign(pending, {
        status: "prompt",
        promptMessage,
        resolvePrompt: (value: string) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
      });
    });
  }
}
