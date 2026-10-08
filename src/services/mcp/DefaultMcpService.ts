import { StdioTransport, StreamableHttpTransport } from "@earendil-works/pi-mcp";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { McpTransportFactory } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Context } from "../../context/Context.js";
import type { LoadedMcpConfig, McpServerConfig } from "@earendil-works/pi-coding-agent";
import { xMcpStore, xSecretService, xMcpOAuthService } from "../../lib/x.js";
import type { McpService, McpOverview } from "./McpService.js";
import type { McpServer } from "../../shared/schemas/mcp.js";

export class DefaultMcpService implements McpService {
  overview(x: Context): McpOverview {
    return {
      servers: Object.entries(xMcpStore(x).list(x)).map(([name, server]) => ({
        name,
        server,
        missingSecrets: this.missing(x, server),
        oauth:
          server.type === "http" &&
          !Object.keys(server.headers ?? {}).some((k) => k.toLowerCase() === "authorization")
            ? xMcpOAuthService(x).status(x, name)
            : { status: "none" as const },
      })),
      revision: this.revision(x),
      applyPolicy: "next-turn",
    };
  }
  revision(x: Context): string {
    // Hash secret values as well, so credential rotation reconnects between turns.
    const servers = xMcpStore(x).list(x);
    const credentials = Object.values(servers)
      .flatMap((s) => [
        ...Object.values(s.type === "http" ? (s.headers ?? {}) : (s.env ?? {})),
        ...(s.type === "http" && s.oauth?.clientSecret ? [s.oauth.clientSecret] : []),
      ])
      .map((value) => {
        const key = /\$\{([A-Z][A-Z0-9_]*)\}/.exec(value)?.[1];
        return key ? (xSecretService(x).get(x, key) ?? "") : "";
      });
    return createHash("sha256")
      .update(JSON.stringify([servers, credentials, xMcpOAuthService(x).revision(x)]))
      .digest("hex");
  }
  private missing(x: Context, server: McpServer): string[] {
    return [
      ...new Set(
        [
          ...Object.values(server.type === "http" ? (server.headers ?? {}) : (server.env ?? {})),
          ...(server.type === "http" && server.oauth?.clientSecret
            ? [server.oauth.clientSecret]
            : []),
        ].flatMap((value) => {
          const key = /\$\{([A-Z][A-Z0-9_]*)\}/.exec(value)?.[1];
          return key && !xSecretService(x).get(x, key) ? [key] : [];
        }),
      ),
    ];
  }
  private resolve(x: Context, server: McpServer): McpServerConfig {
    const missing = this.missing(x, server);
    if (missing.length) throw new Error(`Missing secrets: ${missing.join(", ")}`);
    const config = structuredClone(server);
    const values = config.type === "http" ? config.headers : config.env;
    for (const [key, value] of Object.entries(values ?? {}))
      values![key] = value.replace(
        /\$\{([A-Z][A-Z0-9_]*)\}/g,
        (_, name: string) => xSecretService(x).get(x, name) ?? "",
      );
    return config;
  }
  loadConfig(x: Context): LoadedMcpConfig {
    const errors: string[] = [];
    const servers = Object.entries(xMcpStore(x).list(x)).flatMap(([name, server]) => {
      if (!server.enabled) return [];
      try {
        if (this.missing(x, server).length) throw new Error("Missing credentials");
        return [
          {
            name,
            config: structuredClone(server),
            source: "Vito dashboard",
            scope: "extension" as const,
          },
        ];
      } catch {
        errors.push(`${name}: missing required credentials; check MCP in the dashboard`);
        return [];
      }
    });
    return { servers, errors };
  }
  transport(x: Context): McpTransportFactory {
    return (entry, cwd) => {
      const stored = xMcpStore(x).list(x)[entry.name];
      if (!stored) throw new Error("MCP server was removed");
      const config = this.resolve(x, stored);
      if ("url" in config)
        return new StreamableHttpTransport({
          url: config.url,
          headers: config.headers,
          authProvider: Object.keys(config.headers ?? {}).some(
            (key) => key.toLowerCase() === "authorization",
          )
            ? undefined
            : xMcpOAuthService(x).nativeProvider(x, entry.name),
        });
      const expand = (value: string) =>
        value === "~"
          ? homedir()
          : value.startsWith("~/")
            ? resolve(homedir(), value.slice(2))
            : value;
      const env: Record<string, string> = {};
      for (const key of ["PATH", "HOME", "TMPDIR", "SYSTEMROOT"])
        if (process.env[key]) env[key] = process.env[key]!;
      return new StdioTransport({
        command: expand(config.command),
        args: config.args?.map(expand),
        cwd: resolve(cwd, expand(config.cwd ?? ".")),
        env: { ...env, ...config.env },
        inheritEnv: false,
        stderr: "pipe",
      });
    };
  }
  async test(x: Context, name: string) {
    const stored = xMcpStore(x).list(x)[name];
    if (!stored) throw new Error("MCP server not found");
    const server = this.resolve(x, stored);
    const client = new Client({ name: "vito-mcp-check", version: "1.0.0" });
    const env: Record<string, string> = {};
    for (const key of ["PATH", "HOME", "TMPDIR", "SYSTEMROOT"]) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    const headers = "url" in server ? { ...server.headers } : undefined;
    if (
      "url" in server &&
      !Object.keys(headers ?? {}).some((key) => key.toLowerCase() === "authorization")
    ) {
      const token = await xMcpOAuthService(x).nativeProvider(x, name).token();
      if (token) headers!.Authorization = `Bearer ${token}`;
    }
    const transport =
      "url" in server
        ? new StreamableHTTPClientTransport(new URL(server.url), {
            requestInit: { headers },
          })
        : new StdioClientTransport({
            command: server.command,
            args: server.args,
            cwd: server.cwd,
            env: { ...env, ...server.env },
            stderr: "ignore",
          });
    // Do not return raw remote error strings: they may contain headers or credentials.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        (async () => {
          await client.connect(transport);
          const tools = [];
          let cursor: string | undefined;
          do {
            const page = await client.listTools({ cursor });
            tools.push(...page.tools.map((t) => ({ name: t.name, description: t.description })));
            cursor = page.nextCursor;
            if (tools.length > 2000) throw new Error("Tool limit");
          } while (cursor);
          return { tools };
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Timeout")), 15000);
        }),
      ]);
      return result;
    } catch {
      throw new Error(
        "Connection check failed. Verify the URL/command, credentials and server availability. For OAuth servers, use Connect in the dashboard first.",
      );
    } finally {
      if (timer) clearTimeout(timer);
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
    }
  }
}
