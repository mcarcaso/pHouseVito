import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  createAgentSession,
  createMcpExtension,
  createToolSearchExtension,
  createCodemodeExtension,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { mcpSaveSchema, mcpServerSchema } from "../../src/shared/schemas/mcp.js";
import { ConfigMcpStore } from "../../src/stores/mcp/ConfigMcpStore.js";
import { DefaultMcpService } from "../../src/services/mcp/DefaultMcpService.js";

const fixture = resolve("test/fixtures/mcp-server.mjs");
const stdio = () =>
  mcpServerSchema.parse({ type: "stdio", command: process.execPath, args: [fixture] });
function context() {
  let config = { settings: {}, channels: {}, cron: { jobs: [] }, unrelated: { keep: true } };
  const secrets: Record<string, string> = {};
  const x = new ObjectContext({
    vitoService: () => ({
      getConfig: () => structuredClone(config),
      saveConfig: (_x: unknown, next: typeof config) => {
        config = next;
        return structuredClone(config);
      },
    }),
    mcpOAuthService: () => ({ revision: () => "", status: () => ({ status: "none" }) }),
    mcpStore: () => new ConfigMcpStore(),
    mcpService: () => new DefaultMcpService(),
    secretService: () => ({ get: (_x: unknown, name: string) => secrets[name] }),
  });
  return { x, secrets, config: () => config };
}

test("MCP validates transports, secret references, visibility, names and timeouts", () => {
  assert.equal(stdio().exposure, "deferred");
  for (const input of [
    { type: "http", url: "http://untrusted.example/mcp" },
    { type: "http", url: "https://example.com/mcp?key=secret" },
    { type: "http", url: "https://user:password@example.com/mcp" },
    {
      type: "http",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer actual-secret" },
    },
    { type: "http", url: "https://example.com/mcp", headers: { Authorization: "!cat secret" } },
    { type: "stdio", command: "node", env: { KEY: "!echo secret" } },
    { type: "stdio", command: "node", timeout: 0 },
    { type: "sse", url: "https://example.com" },
  ])
    assert.equal(mcpServerSchema.safeParse(input).success, false);
  assert.equal(mcpSaveSchema.safeParse({ name: "__proto__", server: stdio() }).success, false);
  assert.equal(mcpSaveSchema.safeParse({ name: "bad/name", server: stdio() }).success, false);
  assert.ok(
    mcpServerSchema.safeParse({
      type: "http",
      url: "http://127.0.0.1:1234/mcp",
      headers: { Authorization: "Bearer ${MCP_TEST_TOKEN}" },
      toolExposure: { "delete_*": "hidden" },
    }).success,
  );
});

test("MCP store preserves unrelated config; service keeps credentials out of overview", () => {
  const { x, secrets, config } = context();
  const store = new ConfigMcpStore();
  const service = new DefaultMcpService();
  store.save(
    x,
    "docs",
    mcpServerSchema.parse({
      type: "http",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer ${MCP_TEST_TOKEN}" },
    }),
  );
  assert.deepEqual(config().unrelated, { keep: true });
  assert.match(JSON.stringify(service.overview(x)), /MCP_TEST_TOKEN/);
  assert.equal(service.loadConfig(x).servers.length, 0);
  const before = service.revision(x);
  secrets.MCP_TEST_TOKEN = "a-secret-not-for-the-dashboard";
  assert.notEqual(before, service.revision(x));
  assert.doesNotMatch(JSON.stringify(service.overview(x)), /a-secret-not-for-the-dashboard/);
  assert.equal(service.loadConfig(x).servers[0].config.exposure, "deferred");
  store.save(x, "docs", { ...store.list(x).docs!, enabled: false });
  assert.equal(service.loadConfig(x).servers.length, 0);
  store.remove(x, "docs");
  assert.deepEqual(store.list(x), {});
});

test(
  "MCP connection check lists real stdio tools without calling them",
  { timeout: 20000 },
  async () => {
    const { x } = context();
    new ConfigMcpStore().save(x, "sample", stdio());
    const result = await new DefaultMcpService().test(x, "sample");
    assert.equal(result.tools[0]?.name, "first");
  },
);

async function waitFor(check: () => boolean) {
  const limit = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > limit) throw new Error("Tools did not reconcile");
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

test(
  "native MCP discovers without eager schemas, updates live, reloads without losing history, and shuts down",
  { timeout: 30000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "vito-native-mcp-"));
    const { x } = context();
    const store = new ConfigMcpStore();
    const service = new DefaultMcpService();
    store.save(x, "sample", stdio());
    const settingsManager = SettingsManager.inMemory({});
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt: "Test system prompt",
      extensionFactories: [
        createToolSearchExtension(),
        createCodemodeExtension(),
        createMcpExtension({ loadConfig: () => service.loadConfig(x) }),
      ],
    });
    await loader.reload();
    const { session } = await createAgentSession({
      cwd: dir,
      agentDir: dir,
      settingsManager,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(dir),
    });
    try {
      await session.bindExtensions({
        onError: (error) => {
          throw new Error(error.error);
        },
      });
      await session.sendCustomMessage(
        { customType: "test", content: "HISTORY_TO_KEEP", display: false },
        { triggerTurn: false },
      );
      await waitFor(() => session.getAllTools().some((t) => t.name === "mcp__sample__first"));
      assert.ok(!session.getActiveToolNames().includes("mcp__sample__first"));
      assert.ok(session.getActiveToolNames().includes("tool_search"));
      await waitFor(() => session.getAllTools().some((t) => t.name === "mcp__sample__second"));
      assert.ok(!session.getCallableToolNames().includes("mcp__sample__first"));
      const search = session.agent.state.tools.find((tool) => tool.name === "tool_search");
      assert.ok(search);
      await search.execute("discovery-check", { query: "sample second" });
      const tool = session.agent.state.tools.find((tool) => tool.name === "mcp__sample__second");
      assert.ok(tool, "discovery activates just the selected tool");
      const result = await tool.execute("native-call-check", {});
      assert.match(JSON.stringify(result), /ok/);
      store.remove(x, "sample");
      store.save(x, "replacement", stdio());
      await session.reload();
      await waitFor(() => session.getAllTools().some((t) => t.name === "mcp__replacement__first"));
      assert.ok(!session.getCallableToolNames().some((t) => t.startsWith("mcp__sample__")));
      assert.match(JSON.stringify(session.messages), /HISTORY_TO_KEEP/);
    } finally {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
