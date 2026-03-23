#!/usr/bin/env node

/**
 * config-sync-ui — browser-based interactive config sync for deployed Vito instances.
 *
 * Usage:
 *   node aws_deploy/config-sync-ui.mjs <name>
 *   node aws_deploy/config-sync-ui.mjs --all
 */

import { readFileSync, readdirSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { execSync, exec } from "child_process";
import { createServer } from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "state");
const DEFAULT_CONFIG_PATH = resolve(__dirname, "..", "user.example", "vito.config.json");
const REMOTE_CONFIG_PATH = "/opt/vito/user/vito.config.json";
const KEY_PATH = resolve(process.env.HOME, ".ssh", "vito-deploy.pem");
const SSH_OPTS = `-i ${KEY_PATH} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10`;

// ── Helpers ─────────────────────────────────────────────────────────

function loadState(name) {
  const raw = readFileSync(resolve(STATE_DIR, `${name}.json`), "utf-8");
  return JSON.parse(raw);
}

function getAllNames() {
  return readdirSync(STATE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => basename(f, ".json"));
}

function ssh(ip, cmd) {
  return execSync(`ssh ${SSH_OPTS} ubuntu@${ip} ${JSON.stringify(cmd)}`, {
    encoding: "utf-8",
    timeout: 30000,
  }).trim();
}

function sshWrite(ip, remotePath, content) {
  execSync(
    `ssh ${SSH_OPTS} ubuntu@${ip} "cat > ${remotePath}" << 'CONFIGEOF'\n${content}\nCONFIGEOF`,
    { encoding: "utf-8", timeout: 30000 }
  );
}

function fetchRemoteConfig(ip) {
  const raw = ssh(ip, `cat ${REMOTE_CONFIG_PATH}`);
  return JSON.parse(raw);
}

// ── Main ────────────────────────────────────────────────────────────

const arg = process.argv[2];
if (!arg) {
  console.log("Usage: node aws_deploy/config-sync-ui.mjs <name|--all>");
  process.exit(1);
}

const defaultCfg = JSON.parse(readFileSync(DEFAULT_CONFIG_PATH, "utf-8"));
const names = arg === "--all" ? getAllNames() : [arg];

// Fetch all remote configs
const instances = {};
for (const name of names) {
  const state = loadState(name);
  const ip = state.elastic_ip;
  console.log(`Fetching config from ${name} (${ip})...`);
  try {
    const remoteCfg = fetchRemoteConfig(ip);
    instances[name] = { ip, remoteCfg, error: null };
    console.log(`  OK`);
  } catch (e) {
    instances[name] = { ip, remoteCfg: null, error: e.message };
    console.log(`  FAILED: ${e.message}`);
  }
}

// ── HTML Template ───────────────────────────────────────────────────

function buildHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vito Config Sync</title>
<style>
  :root {
    --bg: #1a1b26; --bg2: #24283b; --bg3: #292e42; --bg4: #343a52;
    --fg: #c0caf5; --fg2: #a9b1d6; --fg3: #565f89;
    --green: #9ece6a; --yellow: #e0af68; --red: #f7768e; --blue: #7aa2f7;
    --cyan: #7dcfff; --magenta: #bb9af7;
    --border: #3b4261; --radius: 6px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace; background: var(--bg); color: var(--fg); min-height: 100vh; }
  .header { background: var(--bg2); border-bottom: 1px solid var(--border); padding: 16px 24px; display: flex; align-items: center; gap: 16px; }
  .header h1 { font-size: 18px; color: var(--cyan); font-weight: 600; }
  .header .instance-info { font-size: 13px; color: var(--fg3); }
  .header .instance-info span { color: var(--fg2); }
  .tabs { display: flex; gap: 2px; margin-left: auto; }
  .tab { padding: 6px 16px; background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius) var(--radius) 0 0; cursor: pointer; color: var(--fg3); font-size: 13px; transition: all 0.15s; }
  .tab:hover { color: var(--fg2); background: var(--bg4); }
  .tab.active { color: var(--cyan); background: var(--bg); border-bottom-color: var(--bg); }
  .container { display: flex; height: calc(100vh - 57px); }
  .tree-panel { flex: 1; overflow-y: auto; padding: 16px; border-right: 1px solid var(--border); }
  .preview-panel { width: 420px; min-width: 320px; display: flex; flex-direction: column; }
  .preview-header { padding: 12px 16px; background: var(--bg2); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  .preview-header h2 { font-size: 14px; color: var(--fg2); }
  .preview-body { flex: 1; overflow-y: auto; padding: 12px; }
  .preview-body pre { font-size: 12px; line-height: 1.5; color: var(--fg2); white-space: pre-wrap; word-break: break-all; }
  .toolbar { padding: 10px 16px; background: var(--bg2); border-bottom: 1px solid var(--border); display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .btn { padding: 6px 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--bg3); color: var(--fg2); font-size: 12px; cursor: pointer; font-family: inherit; transition: all 0.15s; white-space: nowrap; }
  .btn:hover { background: var(--bg4); color: var(--fg); }
  .btn.primary { background: var(--blue); color: var(--bg); border-color: var(--blue); font-weight: 600; }
  .btn.primary:hover { opacity: 0.85; }
  .btn.danger { background: var(--red); color: var(--bg); border-color: var(--red); font-weight: 600; }
  .btn.danger:hover { opacity: 0.85; }
  .btn.success { background: var(--green); color: var(--bg); border-color: var(--green); font-weight: 600; }
  .btn.success:hover { opacity: 0.85; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .separator { width: 1px; height: 24px; background: var(--border); margin: 0 4px; }
  .tree-node { margin-left: 20px; }
  .tree-root { margin-left: 0; }
  .tree-key { display: flex; align-items: flex-start; padding: 3px 8px; border-radius: var(--radius); margin: 1px 0; min-height: 28px; cursor: default; }
  .tree-key:hover { background: var(--bg3); }
  .tree-key.leaf { cursor: pointer; }
  .tree-key.leaf:hover { background: var(--bg4); }
  .key-name { font-weight: 600; color: var(--fg); margin-right: 8px; white-space: nowrap; font-size: 13px; min-width: 0; }
  .key-branch { color: var(--fg3); }
  .key-branch .caret { display: inline-block; width: 14px; text-align: center; transition: transform 0.15s; user-select: none; }
  .key-branch .caret.collapsed { transform: rotate(-90deg); }
  .val-pill { font-size: 11px; padding: 2px 8px; border-radius: 10px; margin-left: 4px; white-space: nowrap; max-width: 200px; overflow: hidden; text-overflow: ellipsis; display: inline-block; }
  .val-default { background: rgba(158, 206, 106, 0.15); color: var(--green); border: 1px solid rgba(158, 206, 106, 0.3); }
  .val-remote { background: rgba(122, 162, 247, 0.15); color: var(--blue); border: 1px solid rgba(122, 162, 247, 0.3); }
  .val-missing { background: rgba(247, 118, 142, 0.15); color: var(--red); border: 1px solid rgba(247, 118, 142, 0.3); }
  .val-extra { background: rgba(122, 162, 247, 0.15); color: var(--blue); border: 1px solid rgba(122, 162, 247, 0.3); }
  .status-match { border-left: 3px solid var(--green); }
  .status-diff { border-left: 3px solid var(--yellow); }
  .status-missing { border-left: 3px solid var(--red); }
  .status-extra { border-left: 3px solid var(--blue); }
  .pick-indicator { font-size: 10px; margin-left: 6px; padding: 1px 6px; border-radius: 8px; font-weight: 600; }
  .picked-default { background: var(--green); color: var(--bg); }
  .picked-remote { background: var(--blue); color: var(--bg); }
  .picked-omit { background: var(--red); color: var(--bg); }
  .vals-row { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; flex: 1; }
  .legend { display: flex; gap: 16px; font-size: 11px; color: var(--fg3); padding: 0 16px; align-items: center; }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .legend-dot { width: 8px; height: 8px; border-radius: 50%; }
  .toast { position: fixed; bottom: 24px; right: 24px; background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 20px; font-size: 13px; color: var(--fg); box-shadow: 0 8px 32px rgba(0,0,0,0.5); z-index: 100; opacity: 0; transform: translateY(10px); transition: all 0.2s; pointer-events: none; }
  .toast.show { opacity: 1; transform: translateY(0); pointer-events: auto; }
  .toast.success { border-color: var(--green); }
  .toast.error { border-color: var(--red); }
  .error-banner { padding: 16px 24px; background: rgba(247,118,142,0.1); border-bottom: 1px solid var(--red); color: var(--red); font-size: 13px; }
  .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--fg3); border-top-color: transparent; border-radius: 50%; animation: spin 0.6s linear infinite; margin-right: 6px; vertical-align: middle; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .context-menu { position: fixed; background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius); padding: 4px 0; z-index: 50; box-shadow: 0 8px 24px rgba(0,0,0,0.4); min-width: 180px; }
  .context-menu-item { padding: 6px 14px; font-size: 12px; cursor: pointer; color: var(--fg2); }
  .context-menu-item:hover { background: var(--bg4); color: var(--fg); }
</style>
</head>
<body>
<div class="header">
  <h1>Vito Config Sync</h1>
  <div class="instance-info" id="instanceInfo"></div>
  <div class="tabs" id="tabs"></div>
</div>
<div class="toolbar">
  <button class="btn" onclick="useAllDefaults()">Use All Defaults</button>
  <button class="btn" onclick="useAllRemote()">Use All Remote</button>
  <div class="separator"></div>
  <button class="btn primary" onclick="copyToClipboard()">Copy JSON</button>
  <button class="btn success" onclick="pushToRemote()">Push to Remote</button>
  <button class="btn" onclick="restartPm2()">Restart PM2</button>
  <div class="separator"></div>
  <div class="legend">
    <div class="legend-item"><div class="legend-dot" style="background:var(--green)"></div> Match</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--yellow)"></div> Different</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--red)"></div> Missing from remote</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--blue)"></div> Extra on remote</div>
  </div>
</div>
<div class="container">
  <div class="tree-panel" id="treePanel"></div>
  <div class="preview-panel">
    <div class="preview-header">
      <h2>Result JSON</h2>
      <span id="jsonSize" style="font-size:11px;color:var(--fg3)"></span>
    </div>
    <div class="preview-body"><pre id="jsonPreview"></pre></div>
  </div>
</div>
<div class="toast" id="toast"></div>
<div class="context-menu" id="contextMenu" style="display:none"></div>

<script>
const DATA = __DATA_PLACEHOLDER__;
const defaultCfg = DATA.defaultCfg;
const instances = DATA.instances;
const instanceNames = Object.keys(instances);

let currentInstance = instanceNames[0];
// picks[instanceName][dotPath] = "default" | "remote" | "omit"
let picks = {};
let collapsed = {};

function init() {
  // Build tabs
  const tabsEl = document.getElementById("tabs");
  if (instanceNames.length > 1) {
    instanceNames.forEach(name => {
      const t = document.createElement("div");
      t.className = "tab" + (name === currentInstance ? " active" : "");
      t.textContent = name;
      t.onclick = () => switchInstance(name);
      tabsEl.appendChild(t);
    });
  }
  // Init picks for all instances
  instanceNames.forEach(name => {
    if (!picks[name]) initPicks(name);
  });
  render();
}

function initPicks(name) {
  picks[name] = {};
  const inst = instances[name];
  if (!inst.remoteCfg) return;
  const allPaths = mergedLeafPaths(defaultCfg, inst.remoteCfg);
  allPaths.forEach(p => {
    const dv = getByPath(defaultCfg, p);
    const rv = getByPath(inst.remoteCfg, p);
    const inDefault = dv !== undefined;
    const inRemote = rv !== undefined;
    if (inRemote && inDefault) {
      picks[name][p] = "remote"; // keep remote for existing
    } else if (!inRemote && inDefault) {
      picks[name][p] = "default"; // add missing from default
    } else {
      picks[name][p] = "remote"; // keep extra remote keys
    }
  });
}

function switchInstance(name) {
  currentInstance = name;
  document.querySelectorAll(".tab").forEach(t => {
    t.classList.toggle("active", t.textContent === name);
  });
  render();
}

function render() {
  const inst = instances[currentInstance];
  const info = document.getElementById("instanceInfo");
  info.innerHTML = '<span>' + currentInstance + '</span> &mdash; ' + (inst.ip || 'unknown');

  const panel = document.getElementById("treePanel");
  if (inst.error) {
    panel.innerHTML = '<div class="error-banner">Failed to fetch config: ' + escHtml(inst.error) + '</div>';
    updatePreview();
    return;
  }
  panel.innerHTML = "";
  const tree = buildTreeData(defaultCfg, inst.remoteCfg);
  panel.appendChild(renderTree(tree, "", true));
  updatePreview();
}

// ── Tree data structure ─────────────────────────────────────────

function buildTreeData(def, remote, prefix) {
  const keys = new Set([
    ...Object.keys(def || {}),
    ...Object.keys(remote || {})
  ]);
  const nodes = [];
  for (const key of keys) {
    const path = prefix ? prefix + "." + key : key;
    const dv = def ? def[key] : undefined;
    const rv = remote ? remote[key] : undefined;
    const dIsObj = dv !== null && dv !== undefined && typeof dv === "object" && !Array.isArray(dv);
    const rIsObj = rv !== null && rv !== undefined && typeof rv === "object" && !Array.isArray(rv);
    if (dIsObj || rIsObj) {
      nodes.push({
        key, path, isLeaf: false,
        children: buildTreeData(dIsObj ? dv : {}, rIsObj ? rv : {}, path)
      });
    } else {
      nodes.push({ key, path, isLeaf: true, defaultVal: dv, remoteVal: rv });
    }
  }
  return nodes;
}

function renderTree(nodes, prefix, isRoot) {
  const container = document.createElement("div");
  container.className = "tree-node" + (isRoot ? " tree-root" : "");
  for (const node of nodes) {
    if (node.isLeaf) {
      container.appendChild(renderLeaf(node));
    } else {
      container.appendChild(renderBranch(node));
    }
  }
  return container;
}

function renderBranch(node) {
  const wrap = document.createElement("div");
  const isCollapsed = collapsed[currentInstance + ":" + node.path];
  const row = document.createElement("div");
  row.className = "tree-key";
  row.innerHTML = '<span class="key-name key-branch"><span class="caret' + (isCollapsed ? ' collapsed' : '') + '">&#9660;</span> ' + escHtml(node.key) + '</span>';
  row.onclick = () => {
    const k = currentInstance + ":" + node.path;
    collapsed[k] = !collapsed[k];
    render();
  };
  wrap.appendChild(row);
  const childContainer = renderTree(node.children, node.path, false);
  if (isCollapsed) childContainer.style.display = "none";
  wrap.appendChild(childContainer);
  return wrap;
}

function renderLeaf(node) {
  const dv = node.defaultVal;
  const rv = node.remoteVal;
  const inDefault = dv !== undefined;
  const inRemote = rv !== undefined;
  const pick = picks[currentInstance][node.path];

  let statusClass;
  if (inDefault && inRemote && JSON.stringify(dv) === JSON.stringify(rv)) {
    statusClass = "status-match";
  } else if (inDefault && !inRemote) {
    statusClass = "status-missing";
  } else if (!inDefault && inRemote) {
    statusClass = "status-extra";
  } else {
    statusClass = "status-diff";
  }

  const row = document.createElement("div");
  row.className = "tree-key leaf " + statusClass;
  row.oncontextmenu = (e) => { e.preventDefault(); showContextMenu(e, node.path, inDefault, inRemote); };
  row.onclick = () => cyclePick(node.path, inDefault, inRemote);

  let html = '<span class="key-name">' + escHtml(node.key) + '</span><div class="vals-row">';
  if (inDefault) {
    html += '<span class="val-pill val-default" title="Default: ' + escAttr(JSON.stringify(dv)) + '">D: ' + escHtml(truncate(JSON.stringify(dv), 30)) + '</span>';
  } else {
    html += '<span class="val-pill val-missing" title="Not in defaults">D: (none)</span>';
  }
  if (inRemote) {
    html += '<span class="val-pill val-remote" title="Remote: ' + escAttr(JSON.stringify(rv)) + '">R: ' + escHtml(truncate(JSON.stringify(rv), 30)) + '</span>';
  } else {
    html += '<span class="val-pill val-missing" title="Not on remote">R: (none)</span>';
  }

  // Pick indicator
  const isMatch = inDefault && inRemote && JSON.stringify(dv) === JSON.stringify(rv);
  if (isMatch) {
    html += '<span class="pick-indicator" style="background:var(--green);color:var(--bg)">MATCH</span>';
  } else if (pick === "default") {
    html += '<span class="pick-indicator picked-default">USE DEFAULT</span>';
  } else if (pick === "remote") {
    html += '<span class="pick-indicator picked-remote">USE REMOTE</span>';
  } else if (pick === "omit") {
    html += '<span class="pick-indicator picked-omit">OMIT</span>';
  }
  html += '</div>';
  row.innerHTML = html;
  return row;
}

function cyclePick(path, inDefault, inRemote) {
  const cur = picks[currentInstance][path];
  const options = [];
  if (inDefault) options.push("default");
  if (inRemote) options.push("remote");
  options.push("omit");
  const idx = options.indexOf(cur);
  picks[currentInstance][path] = options[(idx + 1) % options.length];
  render();
}

function showContextMenu(e, path, inDefault, inRemote) {
  const menu = document.getElementById("contextMenu");
  menu.innerHTML = "";
  const options = [];
  if (inDefault) options.push({ label: "Use Default", value: "default" });
  if (inRemote) options.push({ label: "Use Remote", value: "remote" });
  options.push({ label: "Omit", value: "omit" });
  options.forEach(opt => {
    const item = document.createElement("div");
    item.className = "context-menu-item";
    item.textContent = opt.label;
    item.addEventListener("click", () => {
      picks[currentInstance][path] = opt.value;
      hideContextMenu();
      render();
    });
    menu.appendChild(item);
  });
  menu.style.display = "block";
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";
  setTimeout(() => document.addEventListener("click", hideContextMenu, { once: true }), 0);
}
function hideContextMenu() { document.getElementById("contextMenu").style.display = "none"; }

// ── Bulk operations ─────────────────────────────────────────────

function useAllDefaults() {
  const p = picks[currentInstance];
  for (const path in p) {
    const dv = getByPath(defaultCfg, path);
    if (dv !== undefined) p[path] = "default";
    else p[path] = "omit";
  }
  render();
}

function useAllRemote() {
  const inst = instances[currentInstance];
  if (!inst.remoteCfg) return;
  const p = picks[currentInstance];
  for (const path in p) {
    const rv = getByPath(inst.remoteCfg, path);
    if (rv !== undefined) p[path] = "remote";
    else p[path] = "omit";
  }
  render();
}

// ── Build result config ─────────────────────────────────────────

function buildResult() {
  const result = {};
  const p = picks[currentInstance];
  const inst = instances[currentInstance];
  for (const path in p) {
    const choice = p[path];
    if (choice === "omit") continue;
    let val;
    if (choice === "default") val = getByPath(defaultCfg, path);
    else val = getByPath(inst.remoteCfg, path);
    if (val !== undefined) setByPath(result, path, val);
  }
  return result;
}

function updatePreview() {
  const result = buildResult();
  const json = JSON.stringify(result, null, 2);
  document.getElementById("jsonPreview").textContent = json;
  document.getElementById("jsonSize").textContent = json.length + " chars";
}

// ── Actions ─────────────────────────────────────────────────────

async function copyToClipboard() {
  const json = JSON.stringify(buildResult(), null, 2);
  try {
    await navigator.clipboard.writeText(json);
    showToast("Copied to clipboard!", "success");
  } catch {
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = json;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showToast("Copied to clipboard!", "success");
  }
}

async function pushToRemote() {
  if (!confirm("Push config to " + currentInstance + "?")) return;
  const json = JSON.stringify(buildResult(), null, 2);
  showToast('<span class="spinner"></span>Pushing...', "");
  try {
    const res = await fetch("/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instance: currentInstance, config: json })
    });
    const data = await res.json();
    if (data.ok) {
      showToast("Config pushed to " + currentInstance, "success");
      if (confirm("Restart PM2 on " + currentInstance + "?")) {
        await restartPm2();
      }
    } else {
      showToast("Push failed: " + data.error, "error");
    }
  } catch (e) {
    showToast("Push failed: " + e.message, "error");
  }
}

async function restartPm2() {
  showToast('<span class="spinner"></span>Restarting PM2...', "");
  try {
    const res = await fetch("/restart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instance: currentInstance })
    });
    const data = await res.json();
    if (data.ok) showToast("PM2 restarted on " + currentInstance, "success");
    else showToast("Restart failed: " + data.error, "error");
  } catch (e) {
    showToast("Restart failed: " + e.message, "error");
  }
}

// ── Utilities ───────────────────────────────────────────────────

function getByPath(obj, path) {
  return path.split(".").reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

function setByPath(obj, path, value) {
  const keys = path.split(".");
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] === undefined || cur[keys[i]] === null || typeof cur[keys[i]] !== "object") {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = structuredClone(value);
}

function mergedLeafPaths(a, b, prefix) {
  const paths = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const key of keys) {
    const path = prefix ? prefix + "." + key : key;
    const av = a ? a[key] : undefined;
    const bv = b ? b[key] : undefined;
    const aObj = av !== null && av !== undefined && typeof av === "object" && !Array.isArray(av);
    const bObj = bv !== null && bv !== undefined && typeof bv === "object" && !Array.isArray(bv);
    if (aObj || bObj) {
      paths.push(...mergedLeafPaths(aObj ? av : {}, bObj ? bv : {}, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

function escHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function escAttr(s) { return String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function truncate(s, n) { return s.length > n ? s.slice(0, n) + "..." : s; }

let toastTimer;
function showToast(msg, type) {
  const t = document.getElementById("toast");
  t.innerHTML = msg;
  t.className = "toast show" + (type ? " " + type : "");
  clearTimeout(toastTimer);
  if (type) toastTimer = setTimeout(() => { t.className = "toast"; }, 3000);
}

// Close context menu on scroll
document.addEventListener("scroll", hideContextMenu, true);

init();
</script>
</body>
</html>`;
}

// ── HTTP Server ─────────────────────────────────────────────────

const PORT = 9384;

const server = createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    const dataPayload = JSON.stringify({ defaultCfg, instances });
    const html = buildHTML().replace("__DATA_PLACEHOLDER__", dataPayload);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "POST" && req.url === "/push") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { instance, config } = JSON.parse(body);
        const inst = instances[instance];
        if (!inst || !inst.ip) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Unknown instance: " + instance }));
          return;
        }
        sshWrite(inst.ip, REMOTE_CONFIG_PATH, config);
        // Update cached remote config
        try {
          inst.remoteCfg = JSON.parse(config);
        } catch {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/restart") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { instance } = JSON.parse(body);
        const inst = instances[instance];
        if (!inst || !inst.ip) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Unknown instance: " + instance }));
          return;
        }
        ssh(inst.ip, "cd /opt/vito && npx pm2 restart vito-server");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Config Sync UI running at: ${url}\n`);
  console.log(`  Instances: ${names.join(", ")}\n`);
  // Auto-open browser on macOS
  exec(`open "${url}"`);
});
