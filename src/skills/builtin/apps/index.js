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
  } catch (e) {
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
    execSync(`pm2 start server.js --name "${pm2Name}" --cwd "${appDir}" -- --port ${port}`, {
      stdio: 'pipe',
    });
  } else if (hasPythonServer) {
    execSync(`pm2 start server.py --name "${pm2Name}" --interpreter python3 --cwd "${appDir}" -- --port ${port}`, {
      stdio: 'pipe',
    });
  } else {
    execSync(`pm2 start npx --name "${pm2Name}" -- serve "${appDir}" -l ${port} --no-clipboard`, {
      stdio: 'pipe',
    });
  }

  execSync('pm2 save', { stdio: 'pipe' });
}

function stopAppServer(appName) {
  const pm2Name = `app-${appName}`;
  try {
    execSync(`pm2 delete "${pm2Name}"`, { stdio: 'pipe' });
    execSync('pm2 save', { stdio: 'pipe' });
  } catch (e) {
    // App might not be running
  }
}

async function createApp(name, description, files) {
  ensureAppsDir();

  const appDir = join(getAppsDir(), name);
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
      return `Updated app "${name}" — live at ${meta.url} (port ${meta.port})`;
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
  const url = getAppUrl(name, port);

  saveAppMeta(name, {
    name,
    description,
    port,
    createdAt: new Date().toISOString(),
    url,
  });

  // Start the server (handles deps install, detects server type)
  startAppServer(name, port, appDir);

  return `App "${name}" deployed!\nURL: ${url}\nPort: ${port}\nFiles: ${files.map(f => f.path).join(', ')}`;
}

async function listApps() {
  ensureAppsDir();

  const dirs = readdirSync(getAppsDir(), { withFileTypes: true })
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
      const result = execSync('pm2 jlist', { stdio: ['pipe', 'pipe', 'pipe'] }).toString();
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
  const appDir = join(getAppsDir(), name);

  if (!existsSync(appDir)) {
    return `App "${name}" not found.`;
  }

  stopAppServer(name);
  rmSync(appDir, { recursive: true, force: true });

  return `App "${name}" deleted. Server stopped, files cleaned up.`;
}

export const skill = {
  name: 'apps',
  description: 'Create, deploy, and manage web apps accessible at subdomains of your configured base domain',

  tools: [
    {
      name: 'create_app',
      description: 'Create and deploy a new web app. Write files to apps/<name>/, start a server, and register with PM2. Files should be provided as an array of {path, content} objects. For static sites, just provide HTML/CSS/JS. For Node.js apps, include a server.js that accepts --port flag.',
      input_schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'App name (lowercase, letters/numbers/hyphens only). Used as subdomain if baseDomain is configured.',
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
      description: 'Delete a deployed app. Stops the server and deletes all files.',
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
