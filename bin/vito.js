#!/usr/bin/env node

import { Command } from 'commander';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, '..');

const program = new Command();

// Default workspace location
const DEFAULT_WORKSPACE = join(homedir(), 'ai-assistant');
const PID_FILE = join(DEFAULT_WORKSPACE, '.assistant.pid');

function getWorkspace() {
  return process.env.AI_WORKSPACE || DEFAULT_WORKSPACE;
}

function copyDirRecursive(src, dest) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }
  
  const entries = readdirSync(src);
  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);
    
    if (stat.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

program
  .name('ai')
  .description('Personal AI Assistant — your own customizable AI')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize a new workspace')
  .option('-d, --dir <path>', 'Workspace directory', DEFAULT_WORKSPACE)
  .action((options) => {
    const workspace = options.dir;
    
    if (existsSync(workspace) && readdirSync(workspace).length > 0) {
      console.log(`⚠️  Workspace already exists at ${workspace}`);
      console.log('   Use --dir to specify a different location, or delete the existing workspace.');
      process.exit(1);
    }
    
    console.log(`🚀 Initializing workspace at ${workspace}...`);
    
    // Create workspace directory
    mkdirSync(workspace, { recursive: true });
    
    // Copy template files
    const templateDir = join(packageRoot, 'templates', 'workspace');
    if (existsSync(templateDir)) {
      copyDirRecursive(templateDir, workspace);
    }
    
    // Create subdirectories
    mkdirSync(join(workspace, 'skills'), { recursive: true });
    mkdirSync(join(workspace, 'images'), { recursive: true });
    mkdirSync(join(workspace, 'apps'), { recursive: true });
    
    // Create default config if not copied from template
    if (!existsSync(join(workspace, 'config.json'))) {
      writeFileSync(join(workspace, 'config.json'), JSON.stringify({
        settings: {
          harness: "pi-coding-agent",
          streamMode: "stream",
          memory: {
            currentSessionLimit: 100,
            crossSessionLimit: 5
          }
        },
        channels: {
          dashboard: { enabled: true }
        },
        sessions: {}
      }, null, 2));
    }
    
    // Create empty secrets file
    if (!existsSync(join(workspace, 'secrets.json'))) {
      writeFileSync(join(workspace, 'secrets.json'), JSON.stringify({
        OPENROUTER_API_KEY: ""
      }, null, 2));
    }
    
    // Create default profile
    if (!existsSync(join(workspace, 'profile.json'))) {
      writeFileSync(join(workspace, 'profile.json'), JSON.stringify({
        user: {
          name: "",
          email: ""
        },
        bot: {
          name: ""
        },
        preferences: {},
        notes: {}
      }, null, 2));
    }
    
    console.log('');
    console.log('✅ Workspace initialized!');
    console.log('');
    console.log('Next steps:');
    console.log(`  1. Run: ai start`);
    console.log(`  2. Open the dashboard and start chatting — it'll help you set everything up`);
    console.log('');
  });

program
  .command('start')
  .description('Start the assistant')
  .option('-d, --dir <path>', 'Workspace directory', DEFAULT_WORKSPACE)
  .option('-p, --port <number>', 'Port to run on', '3000')
  .option('-f, --foreground', 'Run in foreground (for Docker)')
  .action((options) => {
    const workspace = options.dir;
    
    if (!existsSync(workspace)) {
      console.log(`❌ Workspace not found at ${workspace}`);
      console.log('   Run: ai init');
      process.exit(1);
    }
    
    // Check if already running (only when not in foreground mode)
    if (!options.foreground && existsSync(PID_FILE)) {
      const pid = readFileSync(PID_FILE, 'utf-8').trim();
      try {
        process.kill(parseInt(pid), 0); // Check if process exists
        console.log(`⚠️  Already running (PID: ${pid})`);
        console.log('   Run: ai stop');
        process.exit(1);
      } catch (e) {
        // Process doesn't exist, clean up stale PID file
        unlinkSync(PID_FILE);
      }
    }
    
    console.log(`🚀 Starting...`);
    console.log(`   Workspace: ${workspace}`);
    console.log(`   Port: ${options.port}`);
    
    const serverPath = join(packageRoot, 'dist', 'index.js');
    
    if (options.foreground) {
      // Run in foreground (for Docker/containers)
      const child = spawn('node', [serverPath, '--port', options.port], {
        cwd: packageRoot,
        env: {
          ...process.env,
          AI_WORKSPACE: workspace,
          PORT: options.port
        },
        stdio: 'inherit'  // Attach to current terminal
      });
      
      child.on('close', (code) => {
        process.exit(code || 0);
      });
    } else {
      // Run in background (normal operation)
      const child = spawn('node', [serverPath, '--port', options.port], {
        cwd: packageRoot,
        env: {
          ...process.env,
          AI_WORKSPACE: workspace,
          PORT: options.port
        },
        detached: true,
        stdio: 'ignore'
      });
      
      // Save PID
      writeFileSync(PID_FILE, child.pid.toString());
      
      child.unref();
      
      console.log('');
      console.log(`✅ Running! (PID: ${child.pid})`);
      console.log(`   Dashboard: http://localhost:${options.port}`);
      console.log('');
      console.log('   Run: ai stop   — to stop');
      console.log('   Run: ai logs   — to view logs');
      console.log('');
    }
  });

program
  .command('stop')
  .description('Stop the assistant')
  .action(() => {
    if (!existsSync(PID_FILE)) {
      console.log('⚠️  Not running');
      process.exit(0);
    }
    
    const pid = readFileSync(PID_FILE, 'utf-8').trim();
    
    try {
      process.kill(parseInt(pid), 'SIGTERM');
      unlinkSync(PID_FILE);
      console.log(`✅ Stopped (PID: ${pid})`);
    } catch (e) {
      console.log(`⚠️  Could not stop process ${pid} — it may have already exited`);
      unlinkSync(PID_FILE);
    }
  });

program
  .command('status')
  .description('Check if the assistant is running')
  .action(() => {
    if (!existsSync(PID_FILE)) {
      console.log('⚪ Not running');
      process.exit(0);
    }
    
    const pid = readFileSync(PID_FILE, 'utf-8').trim();
    
    try {
      process.kill(parseInt(pid), 0);
      console.log(`🟢 Running (PID: ${pid})`);
    } catch (e) {
      console.log('⚪ Not running (stale PID file cleaned up)');
      unlinkSync(PID_FILE);
    }
  });

program
  .command('logs')
  .description('View logs')
  .option('-f, --follow', 'Follow log output')
  .action((options) => {
    const workspace = getWorkspace();
    const logFile = join(workspace, 'assistant.log');
    
    if (!existsSync(logFile)) {
      console.log('No logs found yet.');
      process.exit(0);
    }
    
    if (options.follow) {
      const tail = spawn('tail', ['-f', logFile], { stdio: 'inherit' });
      tail.on('close', () => process.exit(0));
    } else {
      const tail = spawn('tail', ['-n', '50', logFile], { stdio: 'inherit' });
      tail.on('close', () => process.exit(0));
    }
  });

program
  .command('reset')
  .description('Reset workspace to defaults (keeps secrets and profile)')
  .option('-d, --dir <path>', 'Workspace directory', DEFAULT_WORKSPACE)
  .action((options) => {
    const workspace = options.dir;
    
    if (!existsSync(workspace)) {
      console.log(`❌ Workspace not found at ${workspace}`);
      process.exit(1);
    }
    
    console.log('⚠️  This will reset your config and clear your memory database.');
    console.log('   Your secrets.json and profile.json will be preserved.');
    console.log('');
    console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    
    setTimeout(() => {
      // Reset config
      writeFileSync(join(workspace, 'config.json'), JSON.stringify({
        settings: {
          harness: "pi-coding-agent",
          streamMode: "stream",
          memory: {
            currentSessionLimit: 100,
            crossSessionLimit: 5
          }
        },
        channels: {
          dashboard: { enabled: true }
        },
        sessions: {}
      }, null, 2));
      
      // Remove database
      const dbPath = join(workspace, 'assistant.db');
      if (existsSync(dbPath)) {
        unlinkSync(dbPath);
      }
      
      console.log('✅ Workspace reset complete.');
    }, 5000);
  });

program.parse();
