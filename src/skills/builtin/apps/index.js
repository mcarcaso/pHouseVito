import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const APPS_DIR = join(process.cwd(), 'user', 'apps');
const CLOUDFLARE_CONFIG = join(process.env.HOME, '.cloudflared', 'config.yml');
const DOMAIN = 'theworstproductions.com';
const PORT_START = 3100;

function ensureAppsDir() {
  if (!existsSync(APPS_DIR)) {
    mkdirSync(APPS_DIR, { recursive: true });
  }
}

function getUsedPorts() {
  const config = readFileSync(CLOUDFLARE_CONFIG, 'utf-8');
  const ports = [];
  const regex = /localhost:(\d+)/g;
  let match;
  while ((match = regex.exec(config)) !== null) {
    ports.push(parseInt(match[1]));
  }
  return ports;
}

function findAvailablePort() {
  const usedPorts = getUsedPorts();
  let port = PORT_START;
  while (usedPorts.includes(port)) {
    port++;
  }
  return port;
}

function getAppMeta(appName) {
  const metaPath = join(APPS_DIR, appName, '.vito-app.json');
  if (!existsSync(metaPath)) return null;
  return JSON.parse(readFileSync(metaPath, 'utf-8'));
}

function saveAppMeta(appName, meta) {
  const metaPath = join(APPS_DIR, appName, '.vito-app.json');
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

function addCloudflareEntry(appName, port, description) {
  let config = readFileSync(CLOUDFLARE_CONFIG, 'utf-8');
  const entry = `\n  # ${description} (Vito App)\n  - hostname: ${appName}.${DOMAIN}\n    service: http://localhost:${port}\n`;

  const catchAllIndex = config.indexOf('  # Catch-all');
  if (catchAllIndex === -1) {
    const lastNewline = config.lastIndexOf('\n  - service:');
    config = config.slice(0, lastNewline) + entry + config.slice(lastNewline);
  } else {
    config = config.slice(0, catchAllIndex) + entry + config.slice(catchAllIndex);
  }

  writeFileSync(CLOUDFLARE_CONFIG, config);
}

function removeCloudflareEntry(appName) {
  let config = readFileSync(CLOUDFLARE_CONFIG, 'utf-8');
  const hostname = `${appName}.${DOMAIN}`;
  const lines = config.split('\n');
  const filtered = [];
  let skipNext = false;

  for (let i = 0; i < lines.length; i++) {
    if (i + 1 < lines.length && lines[i + 1].includes(hostname)) {
      continue;
    }
    if (lines[i].includes(hostname)) {
      skipNext = true;
      continue;
    }
    if (skipNext && lines[i].trim().startsWith('service:')) {
      skipNext = false;
      if (i + 1 < lines.length && lines[i + 1].trim() === '') {
        i++;
      }
      continue;
    }
    skipNext = false;
    filtered.push(lines[i]);
  }

  writeFileSync(CLOUDFLARE_CONFIG, filtered.join('\n'));
}

/**
 * Detect the app type and start the appropriate server
 */
function startAppServer(appName, port, appDir) {
  const pm2Name = `app-${appName}`;
  const hasNodeServer = existsSync(join(appDir, 'server.js'));
  const hasPythonServer = existsSync(join(appDir, 'server.py'));
  const hasPackageJson = existsSync(join(appDir, 'package.json'));
  const hasRequirementsTxt = existsSync(join(appDir, 'requirements.txt'));

  // Install dependencies if needed
  if (hasPackageJson) {
    try {
      execSync('npm install', { cwd: appDir, stdio: 'pipe', timeout: 60000 });
    } catch (e) {
      throw new Error(`npm install failed: ${e.stderr?.toString() || e.message}`);
    }
  }

  if (hasRequirementsTxt) {
    try {
      execSync('pip3 install -r requirements.txt', { cwd: appDir, stdio: 'pipe', timeout: 60000 });
    } catch (e) {
      throw new Error(`pip install failed: ${e.stderr?.toString() || e.message}`);
    }
  }

  if (hasNodeServer) {
    // Node.js app
    execSync(`npx pm2 start server.js --name "${pm2Name}" --cwd "${appDir}" -- --port ${port}`, {
      stdio: 'pipe',
    });
  } else if (hasPythonServer) {
    // Python app
    execSync(`npx pm2 start server.py --name "${pm2Name}" --interpreter python3 --cwd "${appDir}" -- --port ${port}`, {
      stdio: 'pipe',
    });
  } else {
    // Static site — use npx serve
    execSync(`npx pm2 start npx --name "${pm2Name}" -- serve -s "${appDir}" -l ${port} --no-clipboard`, {
      stdio: 'pipe',
    });
  }

  execSync('npx pm2 save', { stdio: 'pipe' });
}

function stopAppServer(appName) {
  const pm2Name = `app-${appName}`;
  try {
    execSync(`npx pm2 delete "${pm2Name}"`, { stdio: 'pipe' });
    execSync('npx pm2 save', { stdio: 'pipe' });
  } catch (e) {
    // App might not be running
  }
}

function restartTunnel() {
  try {
    execSync('npx pm2 restart cloudflared-tunnel', { stdio: 'pipe' });
  } catch (e) {
    // Tunnel might not be managed by PM2
  }
}

async function createApp(name, description, files) {
  ensureAppsDir();

  const appDir = join(APPS_DIR, name);
  const isUpdate = existsSync(appDir);

  if (isUpdate) {
    // Update existing app — write new files
    for (const file of files) {
      const filePath = join(appDir, file.path);
      const fileDir = join(filePath, '..');
      if (!existsSync(fileDir)) {
        mkdirSync(fileDir, { recursive: true });
      }
      writeFileSync(filePath, file.content);
    }

    const meta = getAppMeta(name);
    if (meta) {
      // Stop and restart to pick up any new deps or server changes
      stopAppServer(name);
      startAppServer(name, meta.port, appDir);
      return `Updated app "${name}" — live at https://${name}.${DOMAIN} (port ${meta.port})`;
    }
  }

  // New app
  mkdirSync(appDir, { recursive: true });

  for (const file of files) {
    const filePath = join(appDir, file.path);
    const fileDir = join(filePath, '..');
    if (!existsSync(fileDir)) {
      mkdirSync(fileDir, { recursive: true });
    }
    writeFileSync(filePath, file.content);
  }

  const port = findAvailablePort();

  saveAppMeta(name, {
    name,
    description,
    port,
    createdAt: new Date().toISOString(),
    url: `https://${name}.${DOMAIN}`,
  });

  // Add to Cloudflare config
  addCloudflareEntry(name, port, description);

  // Create DNS record via cloudflared CLI
  try {
    execSync(`cloudflared tunnel route dns vito-services ${name}.${DOMAIN}`, { stdio: 'pipe' });
  } catch (e) {
    // DNS record might already exist, that's fine
  }

  // Start the server (handles deps install, detects server type)
  startAppServer(name, port, appDir);

  // Restart tunnel to pick up new config
  restartTunnel();

  return `App "${name}" deployed!\nURL: https://${name}.${DOMAIN}\nPort: ${port}\nFiles: ${files.map(f => f.path).join(', ')}`;
}

async function listApps() {
  ensureAppsDir();

  const dirs = readdirSync(APPS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  if (dirs.length === 0) {
    return 'No apps deployed.';
  }

  const apps = dirs.map(name => {
    const meta = getAppMeta(name);
    if (!meta) return `${name} (no metadata)`;

    let status = 'unknown';
    try {
      const result = execSync('npx pm2 jlist', { stdio: ['pipe', 'pipe', 'pipe'] }).toString();
      const processes = JSON.parse(result);
      const proc = processes.find(p => p.name === `app-${name}`);
      status = proc ? proc.pm2_env.status : 'stopped';
    } catch (e) {
      status = 'unknown';
    }

    return `${name} | ${meta.url} | Port ${meta.port} | ${status} | ${meta.description}`;
  });

  return `Deployed Apps:\n${apps.join('\n')}`;
}

async function deleteApp(name) {
  const appDir = join(APPS_DIR, name);

  if (!existsSync(appDir)) {
    return `App "${name}" not found.`;
  }

  stopAppServer(name);
  removeCloudflareEntry(name);
  rmSync(appDir, { recursive: true, force: true });
  restartTunnel();

  return `App "${name}" deleted. Server stopped, tunnel entry removed, files cleaned up.`;
}

export const skill = {
  name: 'apps',
  description: 'Create, deploy, and manage web apps accessible via Cloudflare tunnel at <name>.theworstproductions.com',

  tools: [
    {
      name: 'create_app',
      description: 'Create and deploy a new web app. Write files to user/apps/<name>/, start a server, add Cloudflare tunnel entry, and register with PM2. The app will be live at <name>.theworstproductions.com. Files should be provided as an array of {path, content} objects. For static sites, just provide HTML/CSS/JS. For Node.js apps, include a server.js that accepts --port flag.',
      input_schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'App name (lowercase, letters/numbers/hyphens only). Used as subdomain: <name>.theworstproductions.com',
          },
          description: {
            type: 'string',
            description: 'Short description of the app',
          },
          files: {
            type: 'array',
            description: 'Array of files to create. Each file has a path (relative to app dir) and content.',
            items: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'File path relative to app directory (e.g., "index.html", "css/style.css")',
                },
                content: {
                  type: 'string',
                  description: 'File content',
                },
              },
              required: ['path', 'content'],
            },
          },
        },
        required: ['name', 'description', 'files'],
      },
      async execute({ name, description, files }) {
        try {
          return await createApp(name, description, files);
        } catch (error) {
          return `Failed to create app: ${error.message}`;
        }
      },
    },
    {
      name: 'list_apps',
      description: 'List all deployed apps with their URLs, ports, and status.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
      async execute() {
        try {
          return await listApps();
        } catch (error) {
          return `Failed to list apps: ${error.message}`;
        }
      },
    },
    {
      name: 'delete_app',
      description: 'Delete a deployed app. Stops the server, removes Cloudflare tunnel entry, and deletes all files.',
      input_schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the app to delete',
          },
        },
        required: ['name'],
      },
      async execute({ name }) {
        try {
          return await deleteApp(name);
        } catch (error) {
          return `Failed to delete app: ${error.message}`;
        }
      },
    },
  ],
};

export default skill;
