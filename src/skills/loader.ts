import { readdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { pathToFileURL, fileURLToPath } from "url";
import { Type } from "@sinclair/typebox";

const __dirname = dirname(fileURLToPath(import.meta.url));
import type { ToolDefinition, AgentToolResult } from "@mariozechner/pi-coding-agent";
import type { Tool } from "@anthropic-ai/sdk/resources/index.mjs";

export interface SkillTool extends Tool {
  execute: (input: any) => Promise<string>;
}

export interface LoadedSkill {
  name: string;
  description: string;
  tools: SkillTool[];
}

/**
 * Scan a single skills directory and load all skills.
 */
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
      // Clear the module cache to allow hot-reloading
      const fileUrl = pathToFileURL(indexPath).href;
      const cacheBustedUrl = `${fileUrl}?t=${Date.now()}`;

      const module = await import(cacheBustedUrl);
      const skill = module.skill || module.default;

      if (!skill || !skill.name) {
        console.warn(`Skill ${dir} doesn't export a valid skill object`);
        continue;
      }

      skills.push({
        name: skill.name,
        description: skill.description || "",
        tools: skill.tools || [],
      });
    } catch (err) {
      console.error(`Failed to load skill ${dir}:`, err);
    }
  }

  return skills;
}

/**
 * Dynamically load skills from both built-in and user skills directories.
 * User skills override built-in skills with the same name.
 * Each skill should export a `skill` object with { name, description, tools }.
 */
export async function loadSkillTools(skillsDir: string): Promise<LoadedSkill[]> {
  const builtinDir = resolve(__dirname, "builtin");
  const builtinSkills = await loadSkillsFromDirectory(builtinDir);
  const userSkills = await loadSkillsFromDirectory(skillsDir);

  // Merge: user skills override built-in skills with the same name
  const skillMap = new Map<string, LoadedSkill>();
  
  for (const skill of builtinSkills) {
    skillMap.set(skill.name, skill);
  }
  
  for (const skill of userSkills) {
    skillMap.set(skill.name, skill); // Override built-in if same name
  }

  return Array.from(skillMap.values());
}

/**
 * Convert loaded skill tools to ToolDefinition format for pi-coding-agent's customTools.
 * Optionally accepts a callback to capture tool results for relaying.
 */
export function convertToolsForPi(
  skills: LoadedSkill[],
  onToolResult?: (result: string) => void
): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  for (const skill of skills) {
    for (const tool of skill.tools) {
      const skillExecute = tool.execute;
      tools.push({
        name: tool.name,
        label: tool.name,
        description: tool.description ?? "",
        parameters: Type.Unsafe(tool.input_schema),
        async execute(
          _toolCallId: string,
          params: any,
        ): Promise<AgentToolResult<unknown>> {
          const result = await skillExecute(params);
          
          // Notify callback so tool results can be captured
          if (onToolResult) {
            onToolResult(result);
          }
          
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
