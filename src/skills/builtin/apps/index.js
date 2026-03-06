#!/usr/bin/env node

/**
 * Apps skill CLI
 *
 * Usage:
 *   node index.js create --name "my-app" --description "My app" --files '[{"path":"index.html","content":"<h1>Hello</h1>"}]'
 *   node index.js list
 *   node index.js delete --name "my-app"
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const USER_DIR = join(process.cwd(), 'user');
const PORT_START = 3100;

function getAppsDir() {
  return join(USER_DIR, 'apps');
}

function getConfig() {
  try {
    const configPath = join(USER_DIR, 'vito.config.json');
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    }
  } catch {
    // Fall back to defaults
  }
  return {};
}

function getBaseDomain() {
  const config = getConfig();
  return config.apps?.baseDomain || null;
}

function getPortStart() {
  const config = getConfig();
  return config.apps?.portStart || PORT_START;
}

function ensureAppsDir() {
  const appsDir = getAppsDir();
  if (!existsSync(appsDir)) {
    mkdirSync(appsDir, { recursive: true });
  }
}

function getUsedPorts() {
  const appsDir = getAppsDir();
  if (!existsSync(appsDir)) return [];

  const ports = [];
  const dirs = readdirSync(appsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const name of dirs) {
    const meta = getAppMeta(name);
    if (meta?.port) {
      ports.push(meta.port);
    }
  }
  return ports;
}

function findAvailablePort() {
  const usedPorts = getUsedPorts();
  let port = getPortStart();
  while (usedPorts.includes(port)) {
    port++;
  }
  return port;
}

function getAppMeta(appName) {
  const metaPath = join(getAppsDir(), appName, '.vito-app.json');
  if (!existsSync(metaPath)) return null;
  return JSON.parse(readFileSync(metaPath, 'utf-8'));
}

function saveAppMeta(appName, meta) {
  const metaPath = join(getAppsDir(), appName, '.vito-app.json');
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

function getAppUrl(appName, port) {
  const baseDomain = getBaseDomain();
  if (baseDomain) {
    return `https://${appName}.${baseDomain}`;
  }
  return `http://localhost:${port}`;
}

function startAppServer(appName, port, appDir) {
  const pm2Name = `app-${appName}`;
  const hasNodeServer = existsSync(join(appDir, 'server.js'));
  const hasPythonServer = existsSync(join(appDir, 'server.py'));
  const hasPackageJson = existsSync(join(appDir, 'package.json'));
  const hasRequirementsTxt = existsSync(join(appDir, 'requirements.txt'));

  if (hasPackageJson) {
    try {
      execSync('npm install', { cwd: appDir, stdio: 'pipe', timeout: 120000 });
    } catch (e) {
      throw new Error(`npm install failed: ${e.stderr?.toString() || e.message}`);
    }
  }

  if (hasRequirementsTxt) {
    try {
      execSync('pip3 install -r requirements.txt', { cwd: appDir, stdio: 'pipe', timeout: 120000 });
    } catch (e) {
      throw new Error(`pip install failed: ${e.stderr?.toString() || e.message}`);
    }
  }

  if (hasNodeServer) {
    execSync(`pm2 start server.js --name "${pm2Name}" --cwd "${appDir}" -- --port ${port}`, { stdio: 'pipe' });
  } else if (hasPythonServer) {
    execSync(`pm2 start server.py --name "${pm2Name}" --interpreter python3 --cwd "${appDir}" -- --port ${port}`, { stdio: 'pipe' });
  } else {
    execSync(`pm2 start npx --name "${pm2Name}" -- serve "${appDir}" -l ${port} --no-clipboard`, { stdio: 'pipe' });
  }

  execSync('pm2 save', { stdio: 'pipe' });
}

function stopAppServer(appName) {
  const pm2Name = `app-${appName}`;
  try {
    execSync(`pm2 delete "${pm2Name}"`, { stdio: 'pipe' });
    execSync('pm2 save', { stdio: 'pipe' });
  } catch {
    // App might not be running
  }
}

function createApp(name, description, files) {
  ensureAppsDir();

  const appDir = join(getAppsDir(), name);
  const isUpdate = existsSync(appDir);

  if (isUpdate) {
    for (const file of files) {
      const filePath = join(appDir, file.path);
      const fileDir = join(filePath, '..');
      if (!existsSync(fileDir)) mkdirSync(fileDir, { recursive: true });
      writeFileSync(filePath, file.content);
    }

    const meta = getAppMeta(name);
    if (meta) {
      stopAppServer(name);
      startAppServer(name, meta.port, appDir);
      console.log(`Updated app "${name}" — live at ${meta.url} (port ${meta.port})`);
      return;
    }
  }

  mkdirSync(appDir, { recursive: true });

  for (const file of files) {
    const filePath = join(appDir, file.path);
    const fileDir = join(filePath, '..');
    if (!existsSync(fileDir)) mkdirSync(fileDir, { recursive: true });
    writeFileSync(filePath, file.content);
  }

  const port = findAvailablePort();
  const url = getAppUrl(name, port);

  saveAppMeta(name, {
    name,
    description,
    port,
    createdAt: new Date().toISOString(),
    url,
  });

  startAppServer(name, port, appDir);
  console.log(`App "${name}" deployed!\nURL: ${url}\nPort: ${port}\nFiles: ${files.map(f => f.path).join(', ')}`);
}

function listApps() {
  ensureAppsDir();

  const dirs = readdirSync(getAppsDir(), { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  if (dirs.length === 0) {
    console.log('No apps deployed.');
    return;
  }

  console.log('Deployed Apps:');
  for (const name of dirs) {
    const meta = getAppMeta(name);
    if (!meta) {
      console.log(`${name} (no metadata)`);
      continue;
    }

    let status = 'unknown';
    try {
      const result = execSync('pm2 jlist', { stdio: ['pipe', 'pipe', 'pipe'] }).toString();
      const processes = JSON.parse(result);
      const proc = processes.find(p => p.name === `app-${name}`);
      status = proc ? proc.pm2_env.status : 'stopped';
    } catch {
      status = 'unknown';
    }

    console.log(`${name} | ${meta.url} | Port ${meta.port} | ${status} | ${meta.description}`);
  }
}

function deleteApp(name) {
  const appDir = join(getAppsDir(), name);

  if (!existsSync(appDir)) {
    console.error(`App "${name}" not found.`);
    process.exit(1);
  }

  stopAppServer(name);
  rmSync(appDir, { recursive: true, force: true });
  console.log(`App "${name}" deleted. Server stopped, files cleaned up.`);
}

// --- CLI ---
const [,, command, ...rest] = process.argv;

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1];
      result[key] = val;
      i++;
    }
  }
  return result;
}

try {
  switch (command) {
    case 'create': {
      const args = parseArgs(rest);
      if (!args.name || !args.description || !args.files) {
        console.error('Required: --name, --description, --files (JSON array)');
        process.exit(1);
      }
      const files = JSON.parse(args.files);
      createApp(args.name, args.description, files);
      break;
    }

    case 'list':
      listApps();
      break;

    case 'delete': {
      const args = parseArgs(rest);
      if (!args.name) {
        console.error('Required: --name');
        process.exit(1);
      }
      deleteApp(args.name);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Usage: node index.js <create|list|delete> [options]');
      process.exit(1);
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
