import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve } from "path";
import matter from "gray-matter";
import type { SkillMeta } from "../types.js";

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
  // Builtin skills live in src/skills/builtin/ (not in dist/ since they're just markdown)
  const builtinDir = resolve(process.cwd(), "src/skills/builtin");
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

  const skillList = skills
    .map((s) => {
      const relativePath = s.isBuiltin
        ? `src/skills/builtin/${s.name}/SKILL.md`
        : `user/skills/${s.name}/SKILL.md`;
      return `- **${s.name}** (${relativePath}) — ${s.description}`;
    })
    .join("\n");

  return `Skills are installed in user/skills/ and src/skills/builtin/. When the user asks you to do something, check if a skill exists for it before trying to do it yourself. Skills have a SKILL.md that tells you exactly how to use them — always read it first.

${skillList}`;
}
