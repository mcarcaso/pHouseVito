/**
 * Standalone entrypoint for the Vito MCP server.
 *
 * Boots an Express app on its own port and mounts the same MCP routes that
 * the dashboard would. Use this when you want MCP isolated from vito-server —
 * separate process, separate crash blast radius, separate logs.
 *
 * Production flow:
 *   1. user/ecosystem.config.cjs runs this under pm2 as `vito-mcp`
 *   2. user/apps/vito-mcp/.vito-app.json registers vito-mcp.<domain> → MCP_PORT
 *   3. Dashboard's subdomain proxy forwards matching traffic here
 *
 * Required env (auto-loaded by loadSecrets from user/secrets.json):
 *   MCP_CLIENT_ID, MCP_CLIENT_SECRET
 * Optional env:
 *   MCP_PORT (default 3121)
 */

import express from "express";
import { loadSecrets } from "./secrets.js";
import { loadConfig } from "./config.js";
import { mountMcp } from "./mcp-server.js";

loadSecrets();

// Match vito-server's timezone handling so log timestamps line up across logs.
try {
  const config = loadConfig();
  const tz = config.settings?.timezone;
  if (tz) process.env.TZ = tz;
} catch {
  // Config missing or unreadable — fall back to whatever TZ the env had.
}

const PORT = Number(process.env.MCP_PORT || 3121);
const clientId = process.env.MCP_CLIENT_ID;
const clientSecret = process.env.MCP_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("[mcp-standalone] MCP_CLIENT_ID and MCP_CLIENT_SECRET are required in user/secrets.json. Exiting.");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "2mb" }));
mountMcp(app, {
  staticClientId: clientId,
  staticClientSecret: clientSecret,
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[mcp-standalone] listening on http://127.0.0.1:${PORT} (TZ=${process.env.TZ || "system"})`);
});

process.on("SIGINT", () => { console.log("\n[mcp-standalone] shutting down"); process.exit(0); });
process.on("SIGTERM", () => { console.log("\n[mcp-standalone] shutting down"); process.exit(0); });
