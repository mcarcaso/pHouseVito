import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve } from "path";
import matter from "gray-matter";
import type { SkillMeta } from "../types.js";

/**
 * Scan skills directory for SKILL.md files and parse their frontmatter.
 * Returns an array of skill metadata (name, description, path).
 */
export function discoverSkills(skillsDir: string): SkillMeta[] {
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
      const { data } = matter(raw);

      skills.push({
        name: data.name || dir,
        description: data.description || "",
        path: skillPath,
      });
    } catch {
      // Skip malformed skill files
    }
  }

  return skills;
}

/** Format skill list for inclusion in system prompt */
export function formatSkillsForPrompt(skills: SkillMeta[]): string {
  if (skills.length === 0) return "";

  const lines = skills.map(
    (s) => `- **${s.name}**: ${s.description} (read ${s.path} for full instructions)`
  );

  return `## Available Skills\n\n${lines.join("\n")}`;
}
