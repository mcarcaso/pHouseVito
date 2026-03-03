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
const DEFAULT_WORKSPACE = join(homedir(), 'vito');
const PID_FILE = join(DEFAULT_WORKSPACE, '.vito.pid');

function getWorkspace() {
  return process.env.VITO_WORKSPACE || DEFAULT_WORKSPACE;
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
  .name('vito')
  .description('Vito — Your personal AI assistant')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize a new Vito workspace')
  .option('-d, --dir <path>', 'Workspace directory', DEFAULT_WORKSPACE)
  .action((options) => {
    const workspace = options.dir;
    
    if (existsSync(workspace) && readdirSync(workspace).length > 0) {
      console.log(`⚠️  Workspace already exists at ${workspace}`);
      console.log('   Use --dir to specify a different location, or delete the existing workspace.');
      process.exit(1);
    }
    
    console.log(`🚀 Initializing Vito workspace at ${workspace}...`);
    
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
    if (!existsSync(join(workspace, 'vito.config.json'))) {
      writeFileSync(join(workspace, 'vito.config.json'), JSON.stringify({
        settings: {
          harness: "claude-code",
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
        ANTHROPIC_API_KEY: "",
        OPENROUTER_API_KEY: "",
        // Add more as needed
      }, null, 2));
    }
    
    // Create default profile
    if (!existsSync(join(workspace, 'profile.json'))) {
      writeFileSync(join(workspace, 'profile.json'), JSON.stringify({
        user: {
          name: "",
          email: ""
        },
        preferences: {},
        notes: {}
      }, null, 2));
    }
    
    console.log('');
    console.log('✅ Workspace initialized!');
    console.log('');
    console.log('Next steps:');
    console.log(`  1. Edit ${join(workspace, 'secrets.json')} and add your API keys`);
    console.log(`  2. Edit ${join(workspace, 'profile.json')} to personalize Vito`);
    console.log('  3. Run: vito start');
    console.log('');
  });

program
  .command('start')
  .description('Start Vito')
  .option('-d, --dir <path>', 'Workspace directory', DEFAULT_WORKSPACE)
  .option('-p, --port <number>', 'Port to run on', '3000')
  .action((options) => {
    const workspace = options.dir;
    
    if (!existsSync(workspace)) {
      console.log(`❌ Workspace not found at ${workspace}`);
      console.log('   Run: vito init');
      process.exit(1);
    }
    
    // Check if already running
    if (existsSync(PID_FILE)) {
      const pid = readFileSync(PID_FILE, 'utf-8').trim();
      try {
        process.kill(parseInt(pid), 0); // Check if process exists
        console.log(`⚠️  Vito is already running (PID: ${pid})`);
        console.log('   Run: vito stop');
        process.exit(1);
      } catch (e) {
        // Process doesn't exist, clean up stale PID file
        unlinkSync(PID_FILE);
      }
    }
    
    console.log(`🚀 Starting Vito...`);
    console.log(`   Workspace: ${workspace}`);
    console.log(`   Port: ${options.port}`);
    
    const serverPath = join(packageRoot, 'dist', 'server.js');
    
    const child = spawn('node', [serverPath, '--port', options.port], {
      cwd: packageRoot,
      env: {
        ...process.env,
        VITO_WORKSPACE: workspace,
        PORT: options.port
      },
      detached: true,
      stdio: 'ignore'
    });
    
    // Save PID
    writeFileSync(PID_FILE, child.pid.toString());
    
    child.unref();
    
    console.log('');
    console.log(`✅ Vito is running! (PID: ${child.pid})`);
    console.log(`   Dashboard: http://localhost:${options.port}`);
    console.log('');
    console.log('   Run: vito stop   — to stop');
    console.log('   Run: vito logs   — to view logs');
    console.log('');
  });

program
  .command('stop')
  .description('Stop Vito')
  .action(() => {
    if (!existsSync(PID_FILE)) {
      console.log('⚠️  Vito is not running');
      process.exit(0);
    }
    
    const pid = readFileSync(PID_FILE, 'utf-8').trim();
    
    try {
      process.kill(parseInt(pid), 'SIGTERM');
      unlinkSync(PID_FILE);
      console.log(`✅ Vito stopped (PID: ${pid})`);
    } catch (e) {
      console.log(`⚠️  Could not stop process ${pid} — it may have already exited`);
      unlinkSync(PID_FILE);
    }
  });

program
  .command('status')
  .description('Check if Vito is running')
  .action(() => {
    if (!existsSync(PID_FILE)) {
      console.log('⚪ Vito is not running');
      process.exit(0);
    }
    
    const pid = readFileSync(PID_FILE, 'utf-8').trim();
    
    try {
      process.kill(parseInt(pid), 0);
      console.log(`🟢 Vito is running (PID: ${pid})`);
    } catch (e) {
      console.log('⚪ Vito is not running (stale PID file cleaned up)');
      unlinkSync(PID_FILE);
    }
  });

program
  .command('logs')
  .description('View Vito logs')
  .option('-f, --follow', 'Follow log output')
  .action((options) => {
    const workspace = getWorkspace();
    const logFile = join(workspace, 'vito.log');
    
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
      writeFileSync(join(workspace, 'vito.config.json'), JSON.stringify({
        settings: {
          harness: "claude-code",
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
      const dbPath = join(workspace, 'vito.db');
      if (existsSync(dbPath)) {
        unlinkSync(dbPath);
      }
      
      console.log('✅ Workspace reset complete.');
    }, 5000);
  });

program.parse();
