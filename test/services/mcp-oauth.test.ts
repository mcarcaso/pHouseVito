import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { ConfigMcpStore } from "../../src/stores/mcp/ConfigMcpStore.js";
import { FileMcpOAuthStore } from "../../src/stores/mcp/FileMcpOAuthStore.js";
import { DefaultMcpOAuthService } from "../../src/services/mcp/DefaultMcpOAuthService.js";
import { DefaultMcpService } from "../../src/services/mcp/DefaultMcpService.js";
import { mcpServerSchema } from "../../src/shared/schemas/mcp.js";
import { McpClient } from "@earendil-works/pi-mcp";
import { McpRouterService } from "../../src/routers/McpRouterService.js";
import express from "express";

test(
  "dashboard MCP OAuth: PKCE, state/replay protection, dynamic registration, private storage, native refresh, disconnect",
  { timeout: 30000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "vito-mcp-oauth-"));
    let base = "";
    let refreshes = 0;
    let exchanges = 0;
    let registrations = 0;
    let access = "test-access-one";
    const grants = new Map<string, { challenge: string; redirect: string }>();
    const provider = createServer(async (req, res) => {
      const url = new URL(req.url!, base);
      const json = (value: unknown) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(value));
      };
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
        return json({
          resource: `${base}/mcp`,
          authorization_servers: [base],
          scopes_supported: ["read"],
        });
      if (url.pathname === "/.well-known/oauth-authorization-server")
        return json({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          scopes_supported: ["read"],
        });
      let raw = "";
      for await (const chunk of req) raw += chunk;
      if (url.pathname === "/register") {
        registrations++;
        return json({ ...JSON.parse(raw), client_id: "registered-vito" });
      }
      if (url.pathname === "/authorize") {
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        const code = `code-${grants.size}`;
        grants.set(code, {
          challenge: url.searchParams.get("code_challenge")!,
          redirect: url.searchParams.get("redirect_uri")!,
        });
        const redirect = new URL(url.searchParams.get("redirect_uri")!);
        redirect.searchParams.set("state", url.searchParams.get("state")!);
        redirect.searchParams.set("code", code);
        res.statusCode = 302;
        res.setHeader("Location", redirect.href);
        return res.end();
      }
      if (url.pathname === "/token") {
        const body = new URLSearchParams(raw);
        if (body.get("grant_type") === "refresh_token") {
          refreshes++;
          assert.ok(body.get("refresh_token"));
          access = `test-access-${refreshes + 1}`;
          return json({
            access_token: access,
            token_type: "Bearer",
            refresh_token: `refresh-${refreshes + 1}`,
            expires_in: 3600,
          });
        }
        exchanges++;
        const grant = grants.get(body.get("code")!);
        assert.ok(grant);
        assert.equal(body.get("redirect_uri"), grant.redirect);
        assert.equal(
          createHash("sha256").update(body.get("code_verifier")!).digest("base64url"),
          grant.challenge,
        );
        return json({
          access_token: access,
          token_type: "Bearer",
          refresh_token: "refresh-one",
          expires_in: 3600,
        });
      }
      if (url.pathname === "/mcp") {
        if (req.headers.authorization !== `Bearer ${access}`) {
          res.statusCode = 401;
          res.setHeader(
            "WWW-Authenticate",
            `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
          );
          return json({ error: "unauthorized" });
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const message = JSON.parse(raw);
        if (message.id == null) {
          res.statusCode = 202;
          return res.end();
        }
        return json({
          jsonrpc: "2.0",
          id: message.id,
          result:
            message.method === "initialize"
              ? {
                  protocolVersion: message.params.protocolVersion,
                  serverInfo: { name: "oauth-test", version: "1" },
                  capabilities: { tools: {} },
                }
              : message.method === "tools/list"
                ? { tools: [{ name: "read", inputSchema: { type: "object" } }] }
                : { content: [{ type: "text", text: "authorized" }] },
        });
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
    const address = provider.address();
    assert.ok(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
    let config: any = {
      settings: {},
      channels: {},
      cron: { jobs: [] },
      mcp: { oauthCallbackUrl: "http://127.0.0.1:12345/api/mcp/oauth/callback", servers: {} },
    };
    const store = new ConfigMcpStore();
    const credentials = new FileMcpOAuthStore();
    const oauth = new DefaultMcpOAuthService();
    const mcp = new DefaultMcpService();
    const x = new ObjectContext({
      userDir: () => dir,
      mcpStore: () => store,
      mcpOAuthStore: () => credentials,
      mcpOAuthService: () => oauth,
      mcpService: () => mcp,
      vitoService: () => ({
        getConfig: () => structuredClone(config),
        saveConfig: (_x: unknown, next: unknown) => {
          config = next;
          return config;
        },
      }),
      secretService: () => ({ get: () => undefined }),
      dashboardAuthService: () => ({
        isPasswordSet: () => true,
        isAuthenticated: (_x: unknown, _cookie: unknown, token: unknown) =>
          token === "Bearer owner",
      }),
    });
    store.save(
      x,
      "demo",
      mcpServerSchema.parse({ type: "http", url: `${base}/mcp`, oauth: { scope: "read" } }),
    );
    let dashboard: ReturnType<typeof createServer> | undefined;
    try {
      const start = await oauth.start(x, "demo");
      assert.equal(oauth.status(x, "demo").status, "pending");
      assert.ok(new URL(start.url).searchParams.get("state"));
      assert.equal(registrations, 1);
      const authorization = await fetch(start.url, { redirect: "manual" });
      const callback = new URL(authorization.headers.get("location")!);
      assert.equal(
        await oauth.finish(x, { state: "wrong-state", code: callback.searchParams.get("code")! }),
        false,
      );
      const input = {
        state: callback.searchParams.get("state")!,
        code: callback.searchParams.get("code")!,
      };
      assert.equal(await oauth.finish(x, input), true);
      assert.equal(await oauth.finish(x, input), false);
      assert.equal(exchanges, 1);
      assert.equal(oauth.status(x, "demo").status, "connected");
      assert.equal(statSync(join(dir, "mcp-oauth.json")).mode & 0o777, 0o600);
      assert.doesNotMatch(JSON.stringify(mcp.overview(x)), /test-access|refresh-one|client_secret/);
      assert.equal((await mcp.test(x, "demo")).tools[0].name, "read");
      const native = mcp.transport(x)(
        { name: "demo", config: store.list(x).demo, source: "test" },
        dir,
        undefined,
      );
      const client = new McpClient({ name: "oauth-test", version: "1" });
      await client.connect(native);
      assert.equal((await client.listTools())[0].name, "read");
      await client.close();
      const entry = credentials.get(x, `${base}/mcp`);
      credentials.save(x, `${base}/mcp`, { ...entry, expiresAt: Date.now() - 1 });
      const [a, b] = await Promise.all([
        oauth.nativeProvider(x, "demo").token(),
        oauth.nativeProvider(x, "demo").token(),
      ]);
      assert.equal(a, "test-access-2");
      assert.equal(a, b);
      assert.equal(refreshes, 1);
      assert.equal(credentials.get(x, `${base}/mcp`).tokens?.refresh_token, "refresh-2");
      const cancelled = await oauth.start(x, "demo");
      const cancelledState = new URL(cancelled.url).searchParams.get("state")!;
      oauth.disconnect(x, "demo");
      assert.equal(await oauth.finish(x, { state: cancelledState, code: "unused" }), false);
      assert.equal(oauth.status(x, "demo").status, "none");
      assert.equal(await oauth.nativeProvider(x, "demo").token(), undefined);
      const changed = await oauth.start(x, "demo");
      store.save(x, "demo", { ...store.list(x).demo, enabled: false });
      assert.equal(
        await oauth.finish(x, {
          state: new URL(changed.url).searchParams.get("state")!,
          code: "unused",
        }),
        false,
      );
      const app = express();
      app.use("/api/mcp", await new McpRouterService().createRouter(x));
      dashboard = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => dashboard!.once("listening", resolve));
      const dashAddress = dashboard.address();
      assert.ok(dashAddress && typeof dashAddress !== "string");
      const dashUrl = `http://127.0.0.1:${dashAddress.port}/api/mcp`;
      assert.equal((await fetch(`${dashUrl}/demo/oauth/start`, { method: "POST" })).status, 401);
      assert.equal(
        (await fetch(`${dashUrl}/demo/oauth/disconnect`, { method: "POST" })).status,
        401,
      );
      const invalidCallback = await fetch(`${dashUrl}/oauth/callback?state=invalid&code=unused`);
      assert.equal(invalidCallback.status, 400);
      assert.match(
        invalidCallback.headers.get("content-security-policy")!,
        /frame-ancestors 'none'/,
      );
      assert.equal(invalidCallback.headers.get("cache-control"), "no-store");
    } finally {
      if (dashboard) await new Promise<void>((resolve) => dashboard!.close(() => resolve()));
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("MCP public client metadata contains only public registration fields", () => {
  const x = new ObjectContext({
    vitoService: () => ({ getConfig: () => ({ apps: { baseDomain: "vito.example.com" } }) }),
  });
  const metadata = new DefaultMcpOAuthService().clientMetadata(x);
  assert.deepEqual(metadata, {
    client_id: "https://vito.example.com/api/mcp/oauth/client-metadata",
    client_name: "Vito MCP",
    redirect_uris: ["https://vito.example.com/api/mcp/oauth/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
});
