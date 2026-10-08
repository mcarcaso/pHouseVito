import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
const server = new Server(
  { name: "vito-mcp-test", version: "1.0.0" },
  { capabilities: { tools: { listChanged: true } } },
);
let changed = false;
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: changed ? "second" : "first",
      description: "Read-only test tool",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: "text", text: "ok" }],
}));
await server.connect(new StdioServerTransport());
const timer = setTimeout(async () => {
  changed = true;
  await server.sendToolListChanged().catch(() => {});
}, 700);
process.on("SIGTERM", async () => {
  clearTimeout(timer);
  await server.close();
  process.exit(0);
});
