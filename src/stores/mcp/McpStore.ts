import type { Context } from "../../context/Context.js";
import type { McpServer } from "../../shared/schemas/mcp.js";
export interface McpStore {
  list(x: Context): Record<string, McpServer>;
  save(x: Context, name: string, server: McpServer): void;
  remove(x: Context, name: string): void;
}
