#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import matter from 'gray-matter';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';

const ROOT = process.cwd();
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 50_000;

function usage(exitCode = 1) {
  console.log(`Usage:
  mcp-client list <skill-md-or-url-or-dir>
  mcp-client schema <skill-md-or-url-or-dir> <tool_name>
  mcp-client call <skill-md-or-url-or-dir> <tool_name> '<json_args>'
  mcp-client batch <skill-md-or-url-or-dir> '<json_steps>'

Examples:
  node src/skills/builtin/mcp-client/mcp-client.mjs list user/skills/tavily/SKILL.md
  node src/skills/builtin/mcp-client/mcp-client.mjs call user/skills/tavily/SKILL.md tavily_search '{"query":"news"}'
  node src/skills/builtin/mcp-client/mcp-client.mjs batch user/skills/playwright/SKILL.md '[{"tool":"browser_navigate","args":{"url":"https://example.com"}},{"tool":"browser_snapshot","args":{}}]'
`);
  process.exit(exitCode);
}

function readSecrets() {
  const secretsPath = path.join(ROOT, 'user', 'secrets.json');
  try {
    return JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
  } catch {
    return {};
  }
}

const secrets = readSecrets();
const secretValues = new Set(Object.values(secrets).filter((v) => typeof v === 'string' && v.length >= 6));

function resolveEnvTemplates(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_m, name) => {
      const resolved = process.env[name] ?? secrets[name];
      if (resolved === undefined || resolved === null) {
        throw new Error(`Missing environment/secret value for \${${name}}`);
      }
      return String(resolved);
    });
  }
  if (Array.isArray(value)) return value.map(resolveEnvTemplates);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveEnvTemplates(v)]));
  }
  return value;
}

function maskSecrets(text) {
  let out = String(text ?? '');
  for (const secret of secretValues) out = out.split(secret).join('[REDACTED]');
  return out;
}

function resolveTarget(target) {
  if (!target) usage();

  if (/^https?:\/\//i.test(target)) {
    return { transport: 'http', url: target };
  }

  let filePath = path.resolve(ROOT, target);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'SKILL.md');
  }
  if (!fs.existsSync(filePath)) throw new Error(`Target not found: ${target}`);

  const parsed = matter(fs.readFileSync(filePath, 'utf8'));
  const mcp = parsed.data?.mcp;
  if (!mcp || typeof mcp !== 'object') {
    throw new Error(`No mcp: block found in ${filePath}`);
  }
  return { ...mcp, skillPath: filePath };
}

function normalizeConfig(rawConfig) {
  const config = resolveEnvTemplates(rawConfig);
  config.transport = String(config.transport || (config.url ? 'http' : 'stdio')).toLowerCase();
  config.timeoutMs = Math.min(Number(config.timeoutMs || DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS);
  config.maxOutputBytes = Number(config.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES);
  return config;
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function connect(config) {
  const client = new Client({ name: 'vito-mcp-client-skill', version: '1.0.0' }, { capabilities: {} });
  let transport;

  if (['http', 'streamable-http', 'remote-http'].includes(config.transport)) {
    if (!config.url) throw new Error('HTTP MCP config requires url');
    transport = new StreamableHTTPClientTransport(new URL(config.url));
  } else if (config.transport === 'stdio') {
    if (!config.command) throw new Error('stdio MCP config requires command');
    transport = new StdioClientTransport({
      command: config.command,
      args: Array.isArray(config.args) ? config.args : [],
      env: { ...process.env, ...(config.env || {}) },
      cwd: config.cwd ? path.resolve(ROOT, config.cwd) : ROOT,
    });
  } else {
    throw new Error(`Unsupported MCP transport: ${config.transport}`);
  }

  await withTimeout(client.connect(transport), config.timeoutMs, 'MCP connect');
  return { client, transport };
}

async function listTools(client, config) {
  const result = await withTimeout(
    client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema),
    config.timeoutMs,
    'tools/list',
  );
  return result.tools || [];
}

function isToolAllowed(config, toolName) {
  if (Array.isArray(config.allowTools) && config.allowTools.length > 0) return config.allowTools.includes(toolName);
  if (config.allowToolPrefix) return toolName.startsWith(String(config.allowToolPrefix));
  return true;
}

function capOutput(value, maxBytes) {
  const json = JSON.stringify(value, null, 2);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes <= maxBytes) return json;
  const truncated = Buffer.from(json, 'utf8').subarray(0, maxBytes).toString('utf8');
  return `${truncated}\n... [truncated: ${bytes} bytes total, cap ${maxBytes}]`;
}

async function main() {
  const [rawCommand, target, toolNameOrSteps, jsonArgs = '{}'] = process.argv.slice(2);
  const command = rawCommand === 'tools' ? 'list' : rawCommand === 'invoke' ? 'call' : rawCommand === 'sequence' ? 'batch' : rawCommand;
  if (!command || !target || !['list', 'schema', 'call', 'batch'].includes(command)) usage();

  const config = normalizeConfig(resolveTarget(target));
  let client;
  let transport;
  try {
    ({ client, transport } = await connect(config));
    const tools = await listTools(client, config);

    if (command === 'list') {
      const output = tools
        .filter((tool) => isToolAllowed(config, tool.name))
        .map((tool) => ({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || null,
        }));
      console.log(capOutput(output, config.maxOutputBytes));
      return;
    }

    if (command === 'batch') {
      if (!toolNameOrSteps) usage();
      let steps;
      try {
        steps = JSON.parse(toolNameOrSteps);
      } catch (err) {
        throw new Error(`Invalid JSON steps: ${err.message}`);
      }
      if (!Array.isArray(steps) || steps.length === 0) throw new Error('Batch steps must be a non-empty JSON array');

      const outputs = [];
      for (const [index, step] of steps.entries()) {
        const stepToolName = step?.tool || step?.name;
        if (!stepToolName) throw new Error(`Batch step ${index + 1} is missing tool/name`);
        const stepTool = tools.find((t) => t.name === stepToolName);
        if (!stepTool) throw new Error(`Tool not found in batch step ${index + 1}: ${stepToolName}. Run list first.`);
        if (!isToolAllowed(config, stepToolName)) throw new Error(`Tool blocked by skill MCP allowlist/prefix in batch step ${index + 1}: ${stepToolName}`);
        const stepArgs = step.args || step.arguments || {};
        const result = await withTimeout(
          client.request({ method: 'tools/call', params: { name: stepToolName, arguments: stepArgs } }, CallToolResultSchema),
          config.timeoutMs,
          `tools/call ${stepToolName}`,
        );
        outputs.push({ step: index + 1, tool: stepToolName, result });
      }
      console.log(capOutput(outputs, config.maxOutputBytes));
      return;
    }

    const toolName = toolNameOrSteps;
    if (!toolName) usage();
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) throw new Error(`Tool not found: ${toolName}. Run list first.`);
    if (!isToolAllowed(config, toolName)) throw new Error(`Tool blocked by skill MCP allowlist/prefix: ${toolName}`);

    if (command === 'schema') {
      console.log(capOutput({ name: tool.name, description: tool.description || '', inputSchema: tool.inputSchema || null }, config.maxOutputBytes));
      return;
    }

    let args;
    try {
      args = JSON.parse(jsonArgs || '{}');
    } catch (err) {
      throw new Error(`Invalid JSON args: ${err.message}`);
    }

    const result = await withTimeout(
      client.request({ method: 'tools/call', params: { name: toolName, arguments: args } }, CallToolResultSchema),
      config.timeoutMs,
      `tools/call ${toolName}`,
    );
    console.log(capOutput(result, config.maxOutputBytes));
  } catch (err) {
    console.error(maskSecrets(`mcp-client error: ${err?.message || err}`));
    process.exitCode = 1;
  } finally {
    try { await transport?.close?.(); } catch {}
  }
}

main();
