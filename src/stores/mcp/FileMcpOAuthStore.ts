import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import { xUserDir } from "../../lib/x.js";
import { mcpOAuthEntrySchema, type McpOAuthEntry, type McpOAuthStore } from "./McpOAuthStore.js";
const documentSchema = z.record(z.string(), mcpOAuthEntrySchema);
/** Private credential file, separate from browser-safe server configuration. */
export class FileMcpOAuthStore implements McpOAuthStore {
  private path(x: Context) {
    return join(xUserDir(x), "mcp-oauth.json");
  }
  private key(url: string) {
    return createHash("sha256").update(url).digest("hex");
  }
  private read(x: Context) {
    const path = this.path(x);
    return existsSync(path) ? documentSchema.parse(JSON.parse(readFileSync(path, "utf8"))) : {};
  }
  get(x: Context, url: string): McpOAuthEntry {
    return this.read(x)[this.key(url)] ?? {};
  }
  save(x: Context, url: string, entry: McpOAuthEntry) {
    const all = this.read(x);
    all[this.key(url)] = mcpOAuthEntrySchema.parse(entry);
    this.write(x, all);
  }
  remove(x: Context, url: string) {
    const all = this.read(x);
    delete all[this.key(url)];
    this.write(x, all);
  }
  private write(x: Context, all: Record<string, McpOAuthEntry>) {
    mkdirSync(xUserDir(x), { recursive: true });
    const path = this.path(x);
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(all, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  }
}
