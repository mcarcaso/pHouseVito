# Native MCP (experimental)

Dashboard → Intelligence → MCP manages native Pi MCP servers. This is an experiment on `feat/native-mcp-dashboard`; existing MCP skills and their CLI bridge remain independent.

## Ownership and persistence

- `ConfigMcpStore` provides server CRUD through `VitoService`. Config lives at `mcp.servers` in `user/vito.config.json`; atomic writes preserve other settings. No second MCP database/config file.
- `DefaultMcpService` resolves credentials for discovery checks and prepares native Pi configuration. Secret values belong in `SecretService`; config/UI contains references only.
- `McpRouterService` exposes owner-authenticated, schema-validated list/save/delete/discovery routes. Public and Ask API contexts cannot access MCP management dependencies.
- Pi explicitly loads only MCP, tool-search, and codemode factories, while arbitrary extension loading stays disabled. Ambient `.pi/mcp.json` and global MCP servers are **not** imported.

## Adding a server

Use a stable name (letters, numbers, `_`, `-`). Supported transports:

- Streamable HTTP: HTTPS endpoint, or HTTP on loopback. URLs with credentials, query parameters or fragments are rejected in this initial version. Use header authentication, not URL API keys.
- Local stdio: executable, one argument per line, optional working directory, secret-backed environment entries. Commands run on Vito's machine and are **not sandboxed**. Only install servers you trust. Initialization itself runs the configured command.

Header/environment JSON accepts `${SECRET_NAME}` or `Bearer ${SECRET_NAME}`; literal credentials and shell interpolation are rejected. Add the actual value in Dashboard → Secrets. Missing credentials are surfaced in the MCP screen; those servers are skipped by Pi until configured.

Example configuration:

```json
{
  "mcp": {
    "servers": {
      "docs": {
        "type": "http",
        "url": "https://example.com/mcp",
        "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" },
        "enabled": true,
        "exposure": "deferred",
        "timeout": 30
      }
    }
  }
}
```

## Context and lifecycle

- **On demand (`deferred`)**, the default: individual tool declarations remain out of the model's initial tool list. Pi activates `tool_search`; discovered tools can then be loaded and called normally.
- **Code mode (`codemode-deferred`)**: tools are discovered/called inside codemode, without listing each in its initial description.
- **Always visible (`direct`)**: every tool is declared upfront; larger context footprint.
- **Hidden**: tools unavailable unless per-tool visibility overrides expose them. These are exposure controls, not a sandbox or a global permission system; existing skills/shell access remain independent.

A connected server's tool-list notification is handled live by Pi. Server config/credential changes are detected at the next serialized chat-turn boundary via a configuration-and-credential digest. Pi reloads extensions, closes old connections, and reconnects without clearing the transcript. No mid-call mutation, no Vito process restart for subsequent server edits. The initial code deployment does require an owner restart.

Each Vito conversation owns its own native connections. Stdio servers therefore run per active conversation, not one global process. Shutdown and `/new` explicitly emit Pi's `session_shutdown` event before disposal; plain SDK `dispose()` alone does not close MCP connections.

Removing/disabling a server does not erase previous schemas/results from conversation history or immediately stop an in-flight call. Changes apply next turn; `/new` can clear the current conversation if that is desired.

## Connection check and limitations

“Check connection” opens a separate, time-bounded MCP client, initializes the server, lists tools (including pagination), then closes it. It never calls a tool. This is not a live-chat connection-status indicator. Remote errors are sanitized to avoid returning credentials.

Authentication supports secret-backed headers/environment values and **dashboard OAuth**. URL query credentials, SSE-only servers, and automatic skill migration remain unsupported. Pi's own loopback/browser sign-in command is blocked; use the dashboard flow instead.

## Browser OAuth

For an HTTP server without an Authorization header, use **Connect account → Open authorization page**, approve access at the provider, then return to Vito. The dashboard polls pending authorization and shows saved credentials, reconnect, cancel, and disconnect actions. Public servers can still be checked without signing in.

- Authorization code flow with PKCE S256, cryptographically random state, 10-minute pending-flow expiry, one-use callbacks, and configuration-change checks.
- RFC 9728 resource metadata / authorization-server discovery and dynamic client registration use the MCP SDK. Advanced settings support a pre-registered client ID, optional secret reference, and requested scopes when the provider requires them. Not every provider supports dynamic registration.
- Redirect URI defaults to `https://<apps.baseDomain>/api/mcp/oauth/callback`. Override `mcp.oauthCallbackUrl` when the dashboard has a different public origin; its path must be `/api/mcp/oauth/callback`. HTTPS is required except on loopback. Never derive this URI from incoming Host headers. The provider must permit this redirect URI.
- The callback is state-authenticated, not dashboard-cookie-authenticated, so it works when returning from another browser/device. It has a dedicated restricted context, no-store/no-referrer headers, and a restrictive CSP. Raw provider errors, authorization codes, tokens, and client secrets are not rendered.
- Tokens and dynamic client credentials live in private, atomically written `user/mcp-oauth.json` (mode 0600), not browser-safe configuration. Pending state/verifiers live in memory and expire on restart.
- A shared OAuth service supplies native Pi transports and discovery checks. Native access-token refresh is serialized per server URL to prevent rotated refresh-token races across conversations; rejected tokens may be refreshed on 401. Credential changes participate in the turn-boundary revision digest.
- Disconnect deletes local credentials and invalidates pending flows/in-flight credential writes. It is **not provider-side grant revocation**; revoke access in the provider's account settings when necessary. In-flight tool calls can finish; existing connections reconcile next turn.
- Native stdio transports now inherit only basic process-launch variables plus explicitly configured secret references, rather than every Vito provider secret. Commands are still not sandboxed.

Verification includes a local OAuth/MCP provider covering dynamic registration, state/PKCE, replay and cancelled-flow rejection, credential permissions, authenticated discovery/native access, concurrent refresh rotation, disconnect, configuration changes, and public callback/owner management boundaries. Dashboard OAuth UI states are browser-tested with a mock provider; real-provider consent remains a separate acceptance test.

## Verification

- Schema/security/store/service tests plus authenticated API mutation tests.
- Real local stdio fixture: discovery, server-pushed tool replacement, no eager declarations, reload preserving transcript, and graceful shutdown.
- Isolated dashboard browser QA: light/dark, mobile/wide desktop, add/edit/remove, and real connection discovery. Exports/screenshots stay under private user data, never overwrite live `mobile/dist` during development.
