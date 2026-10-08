import type { Context } from "../../context/Context.js";
import { xVitoService } from "../../lib/x.js";
import { mcpNameSchema, mcpServerSchema, type McpServer } from "../../shared/schemas/mcp.js";
import type { McpStore } from "./McpStore.js";
/** VitoService owns atomic persistence and validation; no second configuration file. */
export class ConfigMcpStore implements McpStore {
  list(x: Context): Record<string, McpServer> {
    return xVitoService(x).getConfig(x).mcp?.servers ?? {};
  }
  save(x: Context, name: string, server: McpServer): void {
    mcpNameSchema.parse(name);
    const config = xVitoService(x).getConfig(x);
    config.mcp = { servers: { ...this.list(x), [name]: mcpServerSchema.parse(server) } };
    xVitoService(x).saveConfig(x, config);
  }
  remove(x: Context, name: string): void {
    mcpNameSchema.parse(name);
    const config = xVitoService(x).getConfig(x);
    const servers = this.list(x);
    delete servers[name];
    config.mcp = { servers };
    xVitoService(x).saveConfig(x, config);
  }
}
