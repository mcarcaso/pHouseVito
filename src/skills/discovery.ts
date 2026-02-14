import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";
import type { SkillMeta } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Scan a single skills directory for SKILL.md files and parse their metadata.
 */
function scanSkillsDirectory(skillsDir: string, isBuiltin: boolean = false): SkillMeta[] {
  if (!existsSync(skillsDir)) return [];

  const skills: SkillMeta[] = [];

  let entries: string[];
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }

  for (const dir of entries) {
    const skillPath = resolve(skillsDir, dir, "SKILL.md");
    if (!existsSync(skillPath)) continue;

    try {
      const raw = readFileSync(skillPath, "utf-8");
      const { data, content } = matter(raw);

      // Extract description from frontmatter or from **Description:** line in content
      let description = data.description || "";
      if (!description) {
        const match = content.match(/\*\*Description:\*\*\s*(.+?)(?:\n|$)/);
        if (match) description = match[1].trim();
      }

      skills.push({
        name: data.name || dir,
        description,
        path: skillPath,
        isBuiltin,
      });
    } catch {
      // Skip malformed skill files
    }
  }

  return skills;
}

/**
 * Scan both built-in and user skills directories.
 * User skills override built-in skills with the same name.
 * Returns an array of skill metadata (name, description, path, isBuiltin).
 */
export function discoverSkills(skillsDir: string): SkillMeta[] {
  const builtinDir = resolve(__dirname, "builtin");
  const builtinSkills = scanSkillsDirectory(builtinDir, true);
  const userSkills = scanSkillsDirectory(skillsDir, false);

  // Merge: user skills override built-in skills with the same name
  const skillMap = new Map<string, SkillMeta>();
  
  for (const skill of builtinSkills) {
    skillMap.set(skill.name, skill);
  }
  
  for (const skill of userSkills) {
    skillMap.set(skill.name, skill); // Override built-in if same name
  }

  return Array.from(skillMap.values());
}

/** Format skill list for inclusion in system prompt */
export function formatSkillsForPrompt(skills: SkillMeta[]): string {
  if (skills.length === 0) return "";

  const lines = skills.map(
    (s) => `- **${s.name}**: ${s.description} (read ${s.path} for full instructions)`
  );

  return `## Available Skills\n\n${lines.join("\n")}`;
}
