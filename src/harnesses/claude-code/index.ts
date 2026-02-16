/**
 * Claude Code Harness
 * 
 * Wraps the Claude Code CLI to implement the Harness interface.
 * Uses stream-json output format for structured event handling.
 */

import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import type { Harness, HarnessCallbacks, HarnessFactory, NormalizedEvent } from "../types.js";

// ════════════════════════════════════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════════════════════════════════════

export interface ClaudeCodeConfig {
  model?: string;  // e.g., "sonnet", "opus", or full model name
  cwd?: string;    // Working directory for Claude Code
  allowedTools?: string[];  // e.g., ["Bash", "Read", "Write", "Edit"]
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
}

const DEFAULT_CONFIG: ClaudeCodeConfig = {
  model: "sonnet",
  permissionMode: "bypassPermissions",  // For automation, we skip permission prompts
};

// ════════════════════════════════════════════════════════════════════════════
// EVENT TYPES (from Claude Code stream-json output)
// These are the actual events we see from `--output-format stream-json`
// ════════════════════════════════════════════════════════════════════════════

interface ClaudeCodeMessageEndEvent {
  type: "message_end";
  message: {
    role: "user" | "assistant";
    content: Array<{ type: "text"; text: string }>;
  };
}

interface ClaudeCodeToolExecutionStartEvent {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: unknown;
}

interface ClaudeCodeToolExecutionEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: {
    content: Array<{ type: "text"; text: string }>;
  };
  isError: boolean;
}

type ClaudeCodeEvent =
  | ClaudeCodeMessageEndEvent
  | ClaudeCodeToolExecutionStartEvent
  | ClaudeCodeToolExecutionEndEvent
  | { type: string; [key: string]: unknown }; // Catch-all for other events

// ════════════════════════════════════════════════════════════════════════════
// HARNESS IMPLEMENTATION
// ════════════════════════════════════════════════════════════════════════════

export class ClaudeCodeHarness implements Harness {
  private config: ClaudeCodeConfig;
  private currentProcess: ChildProcess | null = null;

  constructor(config: ClaudeCodeConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getName(): string {
    return "claude-code";
  }

  getCustomInstructions(): string {
    return `
## Skill System (Claude Code)

Skills are **folders** in user/skills/ containing:
- **SKILL.md** (instructions — ALWAYS present)
- **Optional scripts** (run.js, run.py, run.sh, generate.py, edit.py, index.js, etc.)

**Skills are NOT native Claude Code tools.** They're just documentation and scripts you run manually.

**To use a skill:**
1. **ALWAYS read SKILL.md FIRST**: \`Read user/skills/<skill-name>/SKILL.md\`
   - The SKILL.md tells you EXACTLY which script to run and how to run it
   - Script names vary (run.js, generate.py, edit.sh, etc.) — DO NOT GUESS
2. **Follow the instructions** — the SKILL.md will tell you:
   - What the skill does
   - The EXACT command to run (e.g., \`python3 generate.py "prompt"\`)
   - What parameters it takes
   - What output to expect
3. **Run the script EXACTLY as documented**:
   - If SKILL.md says \`python3 generate.py\`, use that (not \`node run.js\`)
   - If SKILL.md says \`node run.js\`, use that (not \`python generate.py\`)
   - Copy the command format from SKILL.md
4. **Parse the output yourself** (usually JSON or plain text)

**Do NOT:**
- Use the Skill tool — it's not available in this harness
- Assume skills are tools you can call directly
- Guess script names or command formats — ALWAYS read SKILL.md first
- Run \`node run.js\` blindly — many skills use Python, Bash, or other interpreters
    `.trim();
  }

  private buildCliCommand(systemPrompt: string, userMessage: string): string {
    const escape = (s: string) => s.replace(/'/g, "'\\''");
    const model = this.config.model || "sonnet";
    
    let cmd = `claude --model ${model}`;
    
    if (systemPrompt) {
      cmd += ` --system-prompt '${escape(systemPrompt)}'`;
    }
    
    cmd += ` -p '${escape(userMessage)}'`;
    cmd += ` --output-format=stream-json --verbose`;
    
    return cmd;
  }

  async run(
    systemPrompt: string,
    userMessage: string,
    callbacks: HarnessCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Build command args
      const args = [
        "@anthropic-ai/claude-code",
        "--print",
        "--output-format", "stream-json",
        "--verbose",
      ];

      // Add model if specified
      if (this.config.model) {
        args.push("--model", this.config.model);
      }

      // Add system prompt
      if (systemPrompt) {
        args.push("--system-prompt", systemPrompt);
      }

      // Add permission mode
      if (this.config.permissionMode) {
        if (this.config.permissionMode === "bypassPermissions") {
          args.push("--dangerously-skip-permissions");
        } else {
          args.push("--permission-mode", this.config.permissionMode);
        }
      }

      // Add allowed tools
      if (this.config.allowedTools?.length) {
        args.push("--tools", this.config.allowedTools.join(","));
      }

      // Fire invocation callback before we start
      callbacks.onInvocation?.(this.buildCliCommand(systemPrompt, userMessage));

      // Spawn npx process
      const proc = spawn("npx", args, {
        cwd: this.config.cwd || process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      this.currentProcess = proc;

      // Handle abort
      if (signal) {
        signal.addEventListener("abort", () => {
          if (proc.pid) {
            proc.kill("SIGTERM");
          }
        });
      }

      // Read stdout line by line
      const rl = createInterface({ input: proc.stdout! });
      
      rl.on("line", (line) => {
        if (!line.trim()) return;

        try {
          const parsed = JSON.parse(line);
          
          // Always emit raw event (the full line)
          callbacks.onRawEvent(parsed);

          // Claude Code CLI emits events directly as JSON lines
          // No unwrapping needed - the parsed line IS the event
          const event = parsed as ClaudeCodeEvent;

          // Normalize events based on actual Claude Code CLI output
          // Claude Code CLI can emit different formats depending on streaming vs non-streaming
          switch (event.type) {
            case "message_end": {
              // Streaming format: message_end contains the final assembled message
              const msg = event as ClaudeCodeMessageEndEvent;
              if (msg.message.role === "assistant") {
                // Extract text content
                const textContent = msg.message.content
                  .filter(block => block.type === "text")
                  .map(block => block.text)
                  .join("");
                
                if (textContent.trim()) {
                  callbacks.onNormalizedEvent({
                    kind: "assistant",
                    content: textContent,
                  });
                }
              }
              break;
            }

            case "assistant": {
              // Assistant messages contain both text and tool_use blocks
              const assistantEvent = event as {
                type: "assistant";
                message: {
                  role: string;
                  content: Array<
                    | { type: "text"; text: string }
                    | { type: "tool_use"; id: string; name: string; input: unknown }
                  >
                }
              };

              if (assistantEvent.message?.content) {
                // Emit text content
                const textContent = assistantEvent.message.content
                  .filter(block => block.type === "text" && block.text)
                  .map(block => (block as { type: "text"; text: string }).text)
                  .join("");

                if (textContent.trim()) {
                  callbacks.onNormalizedEvent({
                    kind: "assistant",
                    content: textContent,
                  });
                }

                // Emit tool_start for each tool_use block
                const toolUses = assistantEvent.message.content.filter(block => block.type === "tool_use");
                for (const toolUse of toolUses) {
                  const tool = toolUse as { type: "tool_use"; id: string; name: string; input: unknown };
                  callbacks.onNormalizedEvent({
                    kind: "tool_start",
                    tool: tool.name,
                    callId: tool.id,
                    args: tool.input,
                  });
                }
              }
              break;
            }

            case "user": {
              // User messages contain tool_result blocks
              const userEvent = event as {
                type: "user";
                message: {
                  role: string;
                  content: Array<
                    | { type: "text"; text: string }
                    | { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean }
                  >
                }
              };

              if (userEvent.message?.content) {
                // Emit tool_end for each tool_result block
                const toolResults = userEvent.message.content.filter(block => block.type === "tool_result");
                for (const toolResult of toolResults) {
                  const result = toolResult as { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean };
                  callbacks.onNormalizedEvent({
                    kind: "tool_end",
                    tool: "", // We don't have the tool name in tool_result, only the ID
                    callId: result.tool_use_id,
                    result: result.content,
                    success: !result.is_error,
                  });
                }
              }
              break;
            }
          }
        } catch (err) {
          // Not JSON, might be stderr leak or debug output
          console.error("[ClaudeCodeHarness] Failed to parse line:", line);
        }
      });

      // Collect stderr for error reporting
      let stderr = "";
      proc.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      // Handle process completion
      proc.on("close", (code) => {
        this.currentProcess = null;
        
        if (code === 0) {
          resolve();
        } else if (signal?.aborted) {
          callbacks.onNormalizedEvent({
            kind: "error",
            message: "aborted",
          });
          resolve();
        } else {
          const errMsg = stderr.trim() || `Claude Code exited with code ${code}`;
          callbacks.onNormalizedEvent({
            kind: "error",
            message: errMsg,
          });
          reject(new Error(errMsg));
        }
      });

      proc.on("error", (err) => {
        this.currentProcess = null;
        callbacks.onNormalizedEvent({
          kind: "error",
          message: err.message,
        });
        reject(err);
      });

      // Send the user message via stdin
      proc.stdin!.write(userMessage);
      proc.stdin!.end();
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FACTORY
// ════════════════════════════════════════════════════════════════════════════

export const claudeCodeHarnessFactory: HarnessFactory = {
  name: "claude-code",
  displayName: "Claude Code",

  create(config: unknown): Harness {
    return new ClaudeCodeHarness(config as ClaudeCodeConfig);
  },

  getConfigSchema() {
    return {
      type: "object",
      properties: {
        model: {
          type: "string",
          title: "Model",
          description: "Model alias (sonnet, opus) or full name",
          default: "sonnet",
        },
        cwd: {
          type: "string",
          title: "Working Directory",
          description: "Directory for Claude Code to operate in",
        },
        allowedTools: {
          type: "array",
          title: "Allowed Tools",
          description: "List of tools to allow (empty = all)",
          items: { type: "string" },
        },
        permissionMode: {
          type: "string",
          title: "Permission Mode",
          enum: ["default", "acceptEdits", "bypassPermissions", "plan"],
          default: "bypassPermissions",
        },
      },
    };
  },

  getDefaultConfig(): ClaudeCodeConfig {
    return DEFAULT_CONFIG;
  },
};

export default claudeCodeHarnessFactory;
