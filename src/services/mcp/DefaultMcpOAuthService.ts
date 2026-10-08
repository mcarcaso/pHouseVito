import { randomBytes, createHash } from "node:crypto";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { AuthProvider } from "@earendil-works/pi-mcp";
import type { Context } from "../../context/Context.js";
import { xMcpStore, xMcpOAuthStore, xSecretService, xVitoService } from "../../lib/x.js";
import type { McpOAuthService, McpOAuthStatus } from "./McpOAuthService.js";
import type { McpServer } from "../../shared/schemas/mcp.js";
interface Flow {
  name: string;
  server: McpServer & { type: "http" };
  fingerprint: string;
  state: string;
  verifier?: string;
  url?: string;
  callbackUrl: string;
  expires: number;
  consumed: boolean;
}
export class DefaultMcpOAuthService implements McpOAuthService {
  private flows = new Map<string, Flow>();
  private errors = new Map<string, string>();
  private refreshes = new Map<string, Promise<void>>();
  private epochs = new Map<string, number>();
  private server(x: Context, name: string) {
    const server = xMcpStore(x).list(x)[name];
    if (!server || server.type !== "http") throw new Error("OAuth requires an HTTP MCP server");
    if (Object.keys(server.headers ?? {}).some((key) => key.toLowerCase() === "authorization"))
      throw new Error("Remove the Authorization header to use OAuth");
    return server;
  }
  private fingerprint(server: McpServer) {
    return createHash("sha256").update(JSON.stringify(server)).digest("hex");
  }
  private callback(x: Context): string {
    const config = xVitoService(x).getConfig(x);
    const url =
      config.mcp?.oauthCallbackUrl ??
      (config.apps?.baseDomain
        ? `https://${config.apps.baseDomain}/api/mcp/oauth/callback`
        : undefined);
    if (!url || new URL(url).pathname !== "/api/mcp/oauth/callback")
      throw new Error(
        "Configure mcp.oauthCallbackUrl with your dashboard's /api/mcp/oauth/callback URL",
      );
    return url;
  }
  private clean() {
    for (const [state, flow] of this.flows) if (flow.expires < Date.now()) this.flows.delete(state);
  }
  status(x: Context, name: string): McpOAuthStatus {
    this.clean();
    const server = xMcpStore(x).list(x)[name];
    if (!server || server.type !== "http") return { status: "none" };
    if ([...this.flows.values()].some((flow) => flow.name === name)) return { status: "pending" };
    const entry = xMcpOAuthStore(x).get(x, server.url);
    if (this.errors.has(name)) return { status: "error", message: this.errors.get(name) };
    return entry.tokens ? { status: "connected", expiresAt: entry.expiresAt } : { status: "none" };
  }
  revision(x: Context) {
    const credentials = Object.values(xMcpStore(x).list(x)).flatMap((s) =>
      s.type === "http" ? [xMcpOAuthStore(x).get(x, s.url)] : [],
    );
    return createHash("sha256").update(JSON.stringify(credentials)).digest("hex");
  }
  private provider(x: Context, name: string, flow?: Flow): OAuthClientProvider {
    const server = flow?.server ?? this.server(x, name);
    const callbackUrl = flow?.callbackUrl ?? this.callback(x);
    const store = xMcpOAuthStore(x);
    const epoch = this.epochs.get(server.url) ?? 0;
    const check = () => {
      if (
        (this.epochs.get(server.url) ?? 0) !== epoch ||
        this.fingerprint(this.server(x, name)) !== this.fingerprint(server)
      )
        throw new Error("OAuth configuration changed");
    };
    const get = () => store.get(x, server.url);
    const save = (patch: Partial<ReturnType<typeof get>>) => {
      check();
      store.save(x, server.url, { ...get(), ...patch, redirectUrl: callbackUrl });
    };
    const clientSecret = server.oauth?.clientSecret?.replace(
      /\$\{([A-Z][A-Z0-9_]*)\}/g,
      (_, key: string) => {
        const value = xSecretService(x).get(x, key);
        if (!value) throw new Error("Missing OAuth client secret");
        return value;
      },
    );
    return {
      redirectUrl: callbackUrl,
      clientMetadata: {
        client_name: "Vito MCP",
        redirect_uris: [callbackUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: clientSecret ? "client_secret_basic" : "none",
      },
      clientInformation: () =>
        server.oauth?.clientId
          ? {
              client_id: server.oauth.clientId,
              ...(clientSecret ? { client_secret: clientSecret } : {}),
            }
          : get().redirectUrl === callbackUrl
            ? get().client
            : undefined,
      saveClientInformation: (client) => save({ client }),
      tokens: () => get().tokens,
      saveTokens: (tokens) => {
        save({
          tokens,
          expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
        });
        this.errors.delete(name);
      },
      state: () => {
        if (!flow) throw new Error("Connect this server in the dashboard");
        return flow.state;
      },
      redirectToAuthorization: (url) => {
        if (!flow) throw new Error("Connect this server in the dashboard");
        if (
          url.protocol !== "https:" &&
          !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )
          throw new Error("Insecure authorization URL");
        flow.url = url.toString();
      },
      saveCodeVerifier: (verifier) => {
        if (!flow) throw new Error("Connect this server in the dashboard");
        flow.verifier = verifier;
      },
      codeVerifier: () => {
        if (!flow?.verifier) throw new Error("No pending PKCE verifier");
        return flow.verifier;
      },
      invalidateCredentials: (scope) => {
        check();
        if (scope === "all" || scope === "tokens")
          save({ tokens: undefined, expiresAt: undefined });
        if (scope === "all" || scope === "client") save({ client: undefined });
      },
    };
  }
  private fetchFor(serverUrl: string): typeof fetch {
    return async (input, init) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(serverUrl).hostname);
      if (
        url.username ||
        url.password ||
        (url.protocol !== "https:" &&
          !(
            local &&
            url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
          ))
      )
        throw new Error("Invalid OAuth endpoint");
      return fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) });
    };
  }
  async start(x: Context, name: string) {
    this.clean();
    const server = this.server(x, name);
    for (const [state, flow] of this.flows) if (flow.name === name) this.flows.delete(state);
    const flow: Flow = {
      name,
      server,
      fingerprint: this.fingerprint(server),
      state: randomBytes(32).toString("base64url"),
      callbackUrl: this.callback(x),
      expires: Date.now() + 10 * 60 * 1000,
      consumed: false,
    };
    this.flows.set(flow.state, flow);
    this.errors.delete(name);
    try {
      // Explicit reconnect requests a fresh grant rather than silently accepting old tokens.
      const provider = this.provider(x, name, flow);
      const result = await auth(
        { ...provider, tokens: () => undefined },
        { serverUrl: server.url, scope: server.oauth?.scope, fetchFn: this.fetchFor(server.url) },
      );
      if (result !== "REDIRECT" || !flow.url) throw new Error("No authorization URL");
      return { url: flow.url, callbackUrl: flow.callbackUrl };
    } catch {
      this.flows.delete(flow.state);
      this.errors.set(
        name,
        "Could not start authorization. Check server metadata and client settings.",
      );
      throw new Error(this.errors.get(name));
    }
  }
  async finish(x: Context, input: { state: string; code?: string; error?: string }) {
    this.clean();
    const flow = this.flows.get(input.state);
    if (!flow || flow.consumed) return false;
    flow.consumed = true;
    this.flows.delete(input.state);
    try {
      if (
        input.error ||
        !input.code ||
        this.fingerprint(this.server(x, flow.name)) !== flow.fingerprint ||
        this.callback(x) !== flow.callbackUrl
      )
        throw new Error("Authorization rejected or config changed");
      const result = await auth(this.provider(x, flow.name, flow), {
        serverUrl: flow.server.url,
        authorizationCode: input.code,
        scope: flow.server.oauth?.scope,
        fetchFn: this.fetchFor(flow.server.url),
      });
      if (result !== "AUTHORIZED") throw new Error("Authorization incomplete");
      return true;
    } catch {
      this.errors.set(flow.name, "Authorization failed or was cancelled. Try connecting again.");
      return false;
    }
  }
  disconnect(x: Context, name: string) {
    const server = this.server(x, name);
    this.epochs.set(server.url, (this.epochs.get(server.url) ?? 0) + 1);
    for (const [state, flow] of this.flows) if (flow.name === name) this.flows.delete(state);
    this.errors.delete(name);
    xMcpOAuthStore(x).remove(x, server.url);
  }
  nativeProvider(x: Context, name: string): AuthProvider {
    const server = this.server(x, name);
    const refresh = async () => {
      const existing = this.refreshes.get(server.url);
      if (existing) return existing;
      const pending = (async () => {
        try {
          const result = await auth(this.provider(x, name), {
            serverUrl: server.url,
            scope: server.oauth?.scope,
            fetchFn: this.fetchFor(server.url),
          });
          if (result !== "AUTHORIZED") throw new Error("Sign-in required");
        } catch {
          this.errors.set(name, "Sign-in required. Connect this server in the dashboard.");
          throw new Error("MCP sign-in required; use the dashboard");
        }
      })();
      this.refreshes.set(server.url, pending);
      try {
        await pending;
      } finally {
        this.refreshes.delete(server.url);
      }
    };
    return {
      token: async () => {
        let entry = xMcpOAuthStore(x).get(x, server.url);
        if (entry.tokens && entry.expiresAt && entry.expiresAt < Date.now() + 30000) {
          await refresh();
          entry = xMcpOAuthStore(x).get(x, server.url);
        }
        return entry.tokens?.access_token;
      },
      onUnauthorized: async (context) => {
        const current = xMcpOAuthStore(x).get(x, server.url).tokens?.access_token;
        if (current && current !== context.token) return;
        await refresh();
      },
    };
  }
}
