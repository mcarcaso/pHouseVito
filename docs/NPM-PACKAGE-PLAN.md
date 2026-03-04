# Vito NPM Package Plan

## The Split

**You (running from source):**
- Full repo access, can edit anything
- Run with `npm run dev` or PM2
- Your `user/` directory is yours

**Them (npm package):**
- `npm install -g vito-ai`
- Get compiled JS only, no source
- Their workspace is `~/vito/` (or custom path)

---

## Package Structure

What gets published to npm:

```
vito-ai/
├── bin/
│   └── vito.js              # CLI entry point (#!/usr/bin/env node)
├── dist/                    # Compiled TypeScript → JS
│   ├── index.js
│   ├── orchestrator/
│   ├── channels/
│   ├── memory/
│   └── ...
├── skills/                  # Built-in skills (read-only for users)
│   ├── apps/
│   ├── scheduler/
│   ├── keyword-history-search/
│   └── semantic-history-search/
├── dashboard/
│   └── dist/                # Pre-built dashboard static files
├── templates/               # Starter workspace for `vito init`
│   ├── profile.json
│   ├── vito.config.json
│   ├── secrets.json.example
│   ├── SOUL.md
│   └── skills/              # Empty dir for user skills
├── package.json
└── README.md
```

**NOT included:**
- `src/` (TypeScript source)
- `user/` (your personal data)
- `.git/`
- Dev dependencies
- Test files

---

## CLI Commands

```bash
vito init [path]        # Create workspace at ~/vito/ (or custom path)
vito start              # Start dashboard + orchestrator
vito stop               # Stop everything
vito status             # Show running status
vito logs               # Tail the logs
vito upgrade            # Pull latest, rebuild
```

---

## User Workspace (`~/vito/`)

Created by `vito init`:

```
~/vito/
├── profile.json           # User's profile (name, email, preferences)
├── vito.config.json       # Channels, settings, sessions
├── secrets.json           # API keys (OPENROUTER_API_KEY, etc.)
├── SOUL.md                # Optional personality customization
├── vito.db                # SQLite database (messages, embeddings)
├── skills/                # User's custom skills
├── images/                # Generated images, screenshots
├── apps/                  # Deployed web apps
└── logs/                  # Application logs
```

---

## Key Changes Needed

### 1. CLI (`bin/vito.js`)

```javascript
#!/usr/bin/env node
import { program } from 'commander';
import { init, start, stop, status } from '../dist/cli/commands.js';

program
  .name('vito')
  .description('Your personal AI assistant')
  .version('1.0.0');

program
  .command('init [path]')
  .description('Initialize a new Vito workspace')
  .action(init);

program
  .command('start')
  .description('Start Vito')
  .option('-p, --port <number>', 'Dashboard port', '3000')
  .action(start);

program
  .command('stop')
  .description('Stop Vito')
  .action(stop);

program
  .command('status')
  .description('Show Vito status')
  .action(status);

program
  .command('logs')
  .description('Show logs')
  .option('-f, --follow', 'Follow log output')
  .action(logs);

program.parse();
```

### 2. Workspace Resolution

The app needs to know where the user's workspace is:

```javascript
// config/workspace.js
import { homedir } from 'os';
import { existsSync } from 'fs';
import { join } from 'path';

export function getWorkspace() {
  // Check env var first
  if (process.env.VITO_WORKSPACE) {
    return process.env.VITO_WORKSPACE;
  }
  
  // Check for .vitorc in current directory (for running from source)
  if (existsSync('.vitorc')) {
    return process.cwd();
  }
  
  // Default to ~/vito
  return join(homedir(), 'vito');
}
```

### 3. Skill Discovery (dual path)

```javascript
export function discoverSkills() {
  const skills = [];
  
  // Built-in skills (from npm package)
  const builtinPath = join(__dirname, '../skills');
  if (existsSync(builtinPath)) {
    skills.push(...scanSkillsDir(builtinPath, { readonly: true }));
  }
  
  // User skills (from workspace)
  const userPath = join(getWorkspace(), 'skills');
  if (existsSync(userPath)) {
    skills.push(...scanSkillsDir(userPath, { readonly: false }));
  }
  
  // User skills override built-ins with same name
  return dedupeByName(skills);
}
```

### 4. Path Validation (sandbox)

```javascript
export function validateWritePath(targetPath) {
  const resolved = path.resolve(targetPath);
  const workspace = path.resolve(getWorkspace());
  
  if (!resolved.startsWith(workspace)) {
    throw new Error(
      `Cannot write outside workspace. ` +
      `Attempted: ${resolved}, Allowed: ${workspace}`
    );
  }
  
  return resolved;
}
```

### 5. package.json Updates

```json
{
  "name": "vito-ai",
  "version": "1.0.0",
  "description": "Your personal AI assistant",
  "type": "module",
  "bin": {
    "vito": "./bin/vito.js"
  },
  "files": [
    "bin/",
    "dist/",
    "skills/",
    "dashboard/dist/",
    "templates/"
  ],
  "scripts": {
    "build": "tsc && npm run build:dashboard",
    "build:dashboard": "cd dashboard && npm run build",
    "prepublishOnly": "npm run build"
  }
}
```

---

## Process Management

For npm users, we skip PM2 and use simple child processes:

```javascript
// cli/start.js
import { spawn } from 'child_process';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export async function start(options) {
  const workspace = getWorkspace();
  const pidFile = join(workspace, 'vito.pid');
  
  if (existsSync(pidFile)) {
    console.log('Vito is already running. Use `vito stop` first.');
    return;
  }
  
  // Spawn the server as a detached process
  const server = spawn('node', [
    join(__dirname, '../dist/index.js'),
    '--port', options.port
  ], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      VITO_WORKSPACE: workspace
    }
  });
  
  server.unref();
  writeFileSync(pidFile, String(server.pid));
  
  console.log(`Vito started on port ${options.port}`);
  console.log(`Dashboard: http://localhost:${options.port}`);
}
```

---

## Migration Path

1. **Phase 1:** Create CLI structure, workspace resolution
2. **Phase 2:** Update all path references to use `getWorkspace()`
3. **Phase 3:** Add path validation to Write/Edit/Bash tools
4. **Phase 4:** Create templates directory with starter configs
5. **Phase 5:** Test `npm pack` locally, install globally, verify it works
6. **Phase 6:** Publish to npm

---

## Your Setup (unchanged)

You keep running from source:

```bash
cd ~/vito3.0
npm run dev
```

The presence of `.git/` or a `.vitorc` file tells the system "this is dev mode" — no sandbox, full access. You never run `npm install -g vito-ai` on your own machine.

---

## Open Questions

1. **Package name:** `vito-ai`? `vito-assistant`? Check npm availability.
2. **Secrets handling:** Should `vito init` prompt for API keys interactively?
3. **Updates:** How do we handle DB migrations when they upgrade?
4. **Channels:** Should all channels be opt-in during init? (Discord, Telegram, etc.)
