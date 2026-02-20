/**
 * Pi Coding Agent Harness
 * 
 * Wraps @mariozechner/pi-coding-agent to implement the Harness interface.
 */

import { getModel } from "@mariozechner/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager as PiSessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type ToolDefinition,
  type AgentToolResult,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readdirSync } from "fs";
import { pathToFileURL } from "url";
import type { Harness, HarnessCallbacks, HarnessFactory, NormalizedEvent } from "../types.js";

// ════════════════════════════════════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════════════════════════════════════

export interface PiHarnessConfig {
  model?: {
    provider: string;
    name: string;
  };
  thinkingLevel?: "off" | "low" | "medium" | "high";
  skillsDir?: string;
}

const DEFAULT_CONFIG: PiHarnessConfig = {
  model: {
    provider: "anthropic",
    name: "claude-sonnet-4-20250514",
  },
  thinkingLevel: "off",
};

// ════════════════════════════════════════════════════════════════════════════
// SKILL LOADING (simplified from skills/loader.ts)
// ════════════════════════════════════════════════════════════════════════════

interface SkillTool {
  name: string;
  description?: string;
  input_schema: unknown;
  execute: (input: unknown) => Promise<string>;
}

interface LoadedSkill {
  name: string;
  tools: SkillTool[];
}

async function loadSkillsFromDirectory(skillsDir: string): Promise<LoadedSkill[]> {
  if (!existsSync(skillsDir)) return [];

  const skills: LoadedSkill[] = [];
  let entries: string[];

  try {
    entries = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }

  for (const dir of entries) {
    const indexPath = resolve(skillsDir, dir, "index.js");
    if (!existsSync(indexPath)) continue;

    try {
      const fileUrl = pathToFileURL(indexPath).href;
      const cacheBustedUrl = `${fileUrl}?t=${Date.now()}`;
      const module = await import(cacheBustedUrl);
      const skill = module.skill || module.default;

      if (!skill || !skill.name) continue;

      skills.push({
        name: skill.name,
        tools: skill.tools || [],
      });
    } catch (err) {
      console.error(`[PiHarness] Failed to load skill ${dir}:`, err);
    }
  }

  return skills;
}

async function loadAllSkills(skillsDir?: string): Promise<LoadedSkill[]> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const builtinDir = resolve(__dirname, "../../skills/builtin");
  
  const builtinSkills = await loadSkillsFromDirectory(builtinDir);
  const userSkills = skillsDir ? await loadSkillsFromDirectory(skillsDir) : [];

  // Merge: user skills override built-in
  const skillMap = new Map<string, LoadedSkill>();
  for (const skill of builtinSkills) skillMap.set(skill.name, skill);
  for (const skill of userSkills) skillMap.set(skill.name, skill);

  return Array.from(skillMap.values());
}

function convertToolsForPi(
  skills: LoadedSkill[],
  callbacks: HarnessCallbacks
): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  for (const skill of skills) {
    for (const tool of skill.tools) {
      tools.push({
        name: tool.name,
        label: tool.name,
        description: tool.description ?? "",
        parameters: Type.Unsafe(tool.input_schema as Record<string, unknown>),
        async execute(
          toolCallId: string,
          params: unknown,
        ): Promise<AgentToolResult<unknown>> {
          // Tool start is emitted by the harness via subscribe, not here
          const result = await tool.execute(params);
          return {
            content: [{ type: "text" as const, text: result }],
            details: {},
          };
        },
      });
    }
  }

  return tools;
}

// ════════════════════════════════════════════════════════════════════════════
// HARNESS IMPLEMENTATION
// ════════════════════════════════════════════════════════════════════════════

export class PiHarness implements Harness {
  private config: PiHarnessConfig;
  private currentSession: AgentSession | null = null;
  private aborted = false;

  constructor(config: PiHarnessConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  getName(): string {
    return "pi-coding-agent";
  }

  getCustomInstructions(): string {
    return "";  // Pi harness uses the standard Skill tool, no custom instructions needed
  }

  private buildCliCommand(systemPrompt: string, userMessage: string): string {
    const modelConfig = this.config.model || DEFAULT_CONFIG.model!;
    const escape = (s: string) => s.replace(/'/g, "'\\''");
    
    // Pi doesn't have a real CLI, but we can show a representative command
    return `pi-coding-agent --model ${modelConfig.provider}/${modelConfig.name} --system-prompt '${escape(systemPrompt)}' -p '${escape(userMessage)}'`;
  }

  async run(
    systemPrompt: string,
    userMessage: string,
    callbacks: HarnessCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    this.aborted = false;

    // Handle abort signal
    if (signal) {
      signal.addEventListener("abort", async () => {
        this.aborted = true;
        if (this.currentSession) {
          try {
            await this.currentSession.abort();
          } catch {
            // Ignore abort errors
          }
        }
      });
    }

    // Load skills and create tools
    const skills = await loadAllSkills(this.config.skillsDir);
    const customTools = convertToolsForPi(skills, callbacks);

    // Create resource loader with system prompt
    const resourceLoader = new DefaultResourceLoader({
      cwd: process.cwd(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt,
    });
    await resourceLoader.reload();

    // Get model
    const modelConfig = this.config.model || DEFAULT_CONFIG.model!;
    const model = getModel(modelConfig.provider as any, modelConfig.name as any);

    // Create session
    const { session: piSession } = await createAgentSession({
      sessionManager: PiSessionManager.inMemory(),
      model,
      resourceLoader,
      customTools,
      thinkingLevel: this.config.thinkingLevel || "off",
    });

    this.currentSession = piSession;

    // Fire invocation callback before we start
    callbacks.onInvocation?.(this.buildCliCommand(systemPrompt, userMessage));

    // Track current message for assembling assistant content
    let currentMessageText = "";
    let currentThinkingText = "";
    let hasEmittedAssistantText = false;
    let hasEmittedThought = false;

    // Subscribe to events
    const unsubscribe = piSession.subscribe((event: AgentSessionEvent) => {
      // Always emit raw event
      callbacks.onRawEvent(event);

      // Emit normalized events for business logic
      switch (event.type) {
        case "message_start":
          // Reset tracking for new assistant message
          if (event.message.role === "assistant") {
            currentMessageText = "";
            currentThinkingText = "";
            hasEmittedAssistantText = false;
            hasEmittedThought = false;
          }
          break;

        case "message_update": {
          const msgEvent = event.assistantMessageEvent;
          if (msgEvent.type === "text_delta") {
            currentMessageText += msgEvent.delta;
          }
          // Intentionally ignore thinking_delta here to avoid noisy deltas.
          // We only capture thinking from message_end content blocks.
          break;
        }

        case "message_end":
          if (event.message.role === "assistant") {
            // Fallback: some providers only include thinking/text in message_end content
            if ((!currentThinkingText || !currentMessageText) && Array.isArray((event.message as any)?.content)) {
              for (const block of (event.message as any).content) {
                if (!currentThinkingText && block?.type === "thinking" && typeof block.thinking === "string") {
                  currentThinkingText = block.thinking;
                }
                if (!currentMessageText && block?.type === "text" && typeof block.text === "string") {
                  currentMessageText = block.text;
                }
              }
            }

            if (currentThinkingText && !hasEmittedThought) {
              callbacks.onNormalizedEvent({
                kind: "assistant",
                content: currentThinkingText,
              });
              currentThinkingText = "";
              hasEmittedThought = true;
            }

            if (currentMessageText && !hasEmittedAssistantText) {
              callbacks.onNormalizedEvent({
                kind: "assistant",
                content: currentMessageText,
              });
              currentMessageText = "";
              hasEmittedAssistantText = true;
            }
          }
          break;

        case "tool_execution_start":
          callbacks.onNormalizedEvent({
            kind: "tool_start",
            tool: event.toolName,
            callId: event.toolCallId,
            args: event.args,
          });
          break;

        case "tool_execution_end":
          callbacks.onNormalizedEvent({
            kind: "tool_end",
            tool: event.toolName,
            callId: event.toolCallId,
            result: typeof event.result === "string" ? event.result : JSON.stringify(event.result),
            success: !event.isError,
          });
          break;
      }
    });

    try {
      await piSession.prompt(userMessage);
      
      // Emit final assistant/thought if we have content and haven't emitted yet
      // (Pi doesn't always send message_end for assistant messages)
      if (currentThinkingText && !hasEmittedThought) {
        callbacks.onNormalizedEvent({
          kind: "assistant",
          content: currentThinkingText,
        });
        hasEmittedThought = true;
      }
      if (currentMessageText && !hasEmittedAssistantText) {
        callbacks.onNormalizedEvent({
          kind: "assistant",
          content: currentMessageText,
        });
        hasEmittedAssistantText = true;
      }
    } catch (err) {
      if (this.aborted) {
        // Aborted — emit an error event but don't throw
        callbacks.onNormalizedEvent({
          kind: "error",
          message: "aborted",
        });
      } else {
        // Real error
        const message = err instanceof Error ? err.message : String(err);
        callbacks.onNormalizedEvent({
          kind: "error",
          message,
        });
        throw err;
      }
    } finally {
      unsubscribe();
      piSession.dispose();
      this.currentSession = null;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FACTORY
// ════════════════════════════════════════════════════════════════════════════

export const piHarnessFactory: HarnessFactory = {
  name: "pi-coding-agent",
  displayName: "Pi Coding Agent",

  create(config: unknown): Harness {
    return new PiHarness(config as PiHarnessConfig);
  },

  getConfigSchema() {
    return {
      type: "object",
      properties: {
        model: {
          type: "object",
          title: "Model",
          properties: {
            provider: {
              type: "string",
              title: "Provider",
              default: "anthropic",
              enum: ["anthropic", "openai", "google"],
            },
            name: {
              type: "string",
              title: "Model Name",
              default: "claude-sonnet-4-20250514",
            },
          },
        },
        thinkingLevel: {
          type: "string",
          title: "Thinking Level",
          default: "off",
          enum: ["off", "low", "medium", "high"],
        },
        skillsDir: {
          type: "string",
          title: "Skills Directory",
          description: "Path to user skills directory",
        },
      },
    };
  },

  getDefaultConfig(): PiHarnessConfig {
    return DEFAULT_CONFIG;
  },
};

export default piHarnessFactory;
