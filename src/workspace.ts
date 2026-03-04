/**
 * Workspace management and sandbox enforcement
 * 
 * In packaged mode, users are sandboxed to their ~/vito workspace.
 * In dev mode (running from source), full filesystem access is allowed.
 */

import { homedir } from 'os';
import { resolve, join } from 'path';
import { existsSync } from 'fs';

// Check if we're running from source (dev mode) or installed package
function isDevMode(): boolean {
  // If there's a .git directory in the project root, we're in dev mode
  const projectRoot = resolve(__dirname, '..');
  return existsSync(join(projectRoot, '.git'));
}

// Get the user's workspace directory
export function getWorkspace(): string {
  // Environment variable takes precedence
  if (process.env.VITO_WORKSPACE) {
    return resolve(process.env.VITO_WORKSPACE);
  }
  
  // In dev mode, use the user/ directory in the project
  if (isDevMode()) {
    return resolve(__dirname, '..', 'user');
  }
  
  // In package mode, use ~/vito
  return join(homedir(), 'vito');
}

// Get the path to built-in skills (shipped with the package)
export function getBuiltinSkillsPath(): string {
  if (isDevMode()) {
    return resolve(__dirname, 'skills', 'builtin');
  }
  return resolve(__dirname, '..', 'skills');
}

// Get the path to user skills (in their workspace)
export function getUserSkillsPath(): string {
  return join(getWorkspace(), 'skills');
}

// Check if running in sandbox mode (restricted filesystem access)
export function isSandboxed(): boolean {
  // Dev mode = full access
  if (isDevMode()) {
    return false;
  }
  
  // Explicit override via env var
  if (process.env.VITO_SANDBOX === 'false') {
    return false;
  }
  
  // Package mode = sandboxed by default
  return true;
}

/**
 * Validate that a path is within the allowed workspace.
 * Throws an error if the path is outside the sandbox.
 * 
 * @param targetPath - The path to validate
 * @param operation - Description of the operation for error messages
 * @returns The resolved absolute path
 */
export function validatePath(targetPath: string, operation: string = 'access'): string {
  // In dev mode, allow everything
  if (!isSandboxed()) {
    return resolve(targetPath);
  }
  
  const workspace = getWorkspace();
  const resolvedPath = resolve(targetPath);
  const resolvedWorkspace = resolve(workspace);
  
  // Check if the path is within the workspace
  if (!resolvedPath.startsWith(resolvedWorkspace + '/') && resolvedPath !== resolvedWorkspace) {
    throw new Error(
      `🚫 Cannot ${operation} outside your workspace.\n` +
      `   Attempted: ${resolvedPath}\n` +
      `   Workspace: ${resolvedWorkspace}\n` +
      `   Hint: All your files live in ~/vito/`
    );
  }
  
  return resolvedPath;
}

/**
 * Validate a path for reading.
 * In sandbox mode, only allows reading from workspace and built-in skills.
 */
export function validateReadPath(targetPath: string): string {
  // In dev mode, allow everything
  if (!isSandboxed()) {
    return resolve(targetPath);
  }
  
  const resolvedPath = resolve(targetPath);
  const workspace = resolve(getWorkspace());
  const builtinSkills = resolve(getBuiltinSkillsPath());
  
  // Allow reading from workspace
  if (resolvedPath.startsWith(workspace + '/') || resolvedPath === workspace) {
    return resolvedPath;
  }
  
  // Allow reading built-in skills
  if (resolvedPath.startsWith(builtinSkills + '/') || resolvedPath === builtinSkills) {
    return resolvedPath;
  }
  
  throw new Error(
    `🚫 Cannot read files outside your workspace.\n` +
    `   Attempted: ${resolvedPath}\n` +
    `   Workspace: ${workspace}`
  );
}

/**
 * Validate a path for writing.
 * In sandbox mode, only allows writing to workspace (not built-in skills).
 */
export function validateWritePath(targetPath: string): string {
  return validatePath(targetPath, 'write to');
}

/**
 * Check if a command should be allowed in sandbox mode.
 * Returns an error message if blocked, or null if allowed.
 */
export function validateBashCommand(command: string): string | null {
  // In dev mode, allow everything
  if (!isSandboxed()) {
    return null;
  }
  
  // Block obviously dangerous commands
  const blockedPatterns = [
    /\brm\s+-rf?\s+[\/~]/,      // rm -rf / or ~
    /\bsudo\b/,                  // sudo anything
    /\bchmod\b.*\s+[\/~]/,       // chmod on system paths
    /\bchown\b/,                 // chown
    /\bkill\b.*-9/,              // kill -9
    /\bmkfs\b/,                  // mkfs
    /\bdd\b.*of=/,               // dd writes
    /\bcurl\b.*\|\s*sh/,         // curl | sh
    /\bwget\b.*\|\s*sh/,         // wget | sh
  ];
  
  for (const pattern of blockedPatterns) {
    if (pattern.test(command)) {
      return `🚫 This command is blocked in sandbox mode for safety.`;
    }
  }
  
  // Warn about commands that reference paths outside workspace
  const workspace = getWorkspace();
  const absolutePathPattern = /(?:^|\s)(\/(?!tmp)[^\s]+)/g;
  let match;
  while ((match = absolutePathPattern.exec(command)) !== null) {
    const path = match[1];
    if (!path.startsWith(workspace) && !path.startsWith('/tmp')) {
      // It's a warning, not a block — some read-only commands are fine
      // The actual enforcement happens at the filesystem level
    }
  }
  
  return null;
}

// Export workspace info for debugging
export function getWorkspaceInfo() {
  return {
    workspace: getWorkspace(),
    builtinSkills: getBuiltinSkillsPath(),
    userSkills: getUserSkillsPath(),
    isDevMode: isDevMode(),
    isSandboxed: isSandboxed(),
  };
}
