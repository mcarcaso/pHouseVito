import type { Context } from "../../context/Context.js";
import type { LoadedMcpConfig } from "@earendil-works/pi-coding-agent";
import type { McpServer } from "../../shared/schemas/mcp.js";
export interface McpOverview {
  servers: { name: string; server: McpServer; missingSecrets: string[] }[];
  revision: string;
  applyPolicy: "next-turn";
}
export interface McpService {
  overview(x: Context): McpOverview;
  revision(x: Context): string;
  loadConfig(x: Context): LoadedMcpConfig;
  test(x: Context, name: string): Promise<{ tools: { name: string; description?: string }[] }>;
}
