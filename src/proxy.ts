/**
 * Reverse proxy for routing subdomain requests to the correct app
 * 
 * When baseDomain is configured, this handles:
 * - {baseDomain} → main dashboard
 * - {appName}.{baseDomain} → app on its port
 */

import httpProxy from 'http-proxy';
const { createProxyServer } = httpProxy;
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { getWorkspace } from './workspace.js';

interface AppMeta {
  name: string;
  port: number;
  url: string;
}

function getConfig() {
  try {
    const configPath = join(getWorkspace(), 'config.json');
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {
    // Fall back to defaults
  }
  return {};
}

function getBaseDomain(): string | null {
  const config = getConfig();
  // Config takes precedence, then env var
  return config.apps?.baseDomain || process.env.AI_BASE_DOMAIN || null;
}

function getAppMeta(appName: string): AppMeta | null {
  const metaPath = join(getWorkspace(), 'apps', appName, '.app-meta.json');
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8'));
  } catch {
    return null;
  }
}

function getAllApps(): Map<string, number> {
  const appsDir = join(getWorkspace(), 'apps');
  const apps = new Map<string, number>();
  
  if (!existsSync(appsDir)) return apps;
  
  const dirs = readdirSync(appsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  for (const name of dirs) {
    const meta = getAppMeta(name);
    if (meta?.port) {
      apps.set(name, meta.port);
    }
  }
  
  return apps;
}

export function startProxyServer(mainPort: number, proxyPort: number) {
  const baseDomain = getBaseDomain();
  
  if (!baseDomain) {
    console.log('[Proxy] No baseDomain configured, skipping subdomain proxy');
    return null;
  }
  
  const proxy = createProxyServer({});
  
  proxy.on('error', (err, req, res) => {
    console.error('[Proxy] Error:', err.message);
    if (res instanceof ServerResponse && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway');
    }
  });
  
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const host = req.headers.host || '';
    
    // Extract subdomain from host
    // e.g., "myapp.vito-test.theworstproductions.com" with baseDomain "vito-test.theworstproductions.com"
    // Should extract "myapp"
    
    let targetPort = mainPort; // Default to dashboard
    
    if (host.endsWith(baseDomain) && host !== baseDomain) {
      // It's a subdomain
      const subdomain = host.replace(`.${baseDomain}`, '');
      
      // Refresh apps list on each request (hot reload)
      const apps = getAllApps();
      const appPort = apps.get(subdomain);
      
      if (appPort) {
        targetPort = appPort;
        console.log(`[Proxy] ${host} → localhost:${targetPort}`);
      } else {
        console.log(`[Proxy] Unknown subdomain: ${subdomain}, falling back to dashboard`);
      }
    }
    
    proxy.web(req, res, { target: `http://localhost:${targetPort}` });
  });
  
  // Handle WebSocket upgrades
  server.on('upgrade', (req, socket, head) => {
    const host = req.headers.host || '';
    let targetPort = mainPort;
    
    if (host.endsWith(baseDomain) && host !== baseDomain) {
      const subdomain = host.replace(`.${baseDomain}`, '');
      const apps = getAllApps();
      const appPort = apps.get(subdomain);
      if (appPort) {
        targetPort = appPort;
      }
    }
    
    proxy.ws(req, socket, head, { target: `http://localhost:${targetPort}` });
  });
  
  server.listen(proxyPort, () => {
    console.log(`[Proxy] Subdomain proxy running on port ${proxyPort}`);
    console.log(`[Proxy] Base domain: ${baseDomain}`);
    console.log(`[Proxy] Main dashboard: ${baseDomain} → :${mainPort}`);
    console.log(`[Proxy] Apps: *.${baseDomain} → app ports`);
  });
  
  return server;
}
