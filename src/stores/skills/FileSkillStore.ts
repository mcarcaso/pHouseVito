import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import { xBuiltinSkillsDir, xSkillsDir } from "../../lib/x.js";
import {
  StorePermissionDeniedError,
  StoreRecordNotFoundError,
  UnsupportedStoreOperationError,
} from "../Store.js";
import type {
  CreateSkillArgs,
  DeleteSkillArgs,
  Skill,
  SkillFile,
  SkillFilter,
  SkillListArgs,
  SkillSource,
  SkillStore,
  UpdateSkillArgs,
} from "./SkillStore.js";

const skillNameSchema = z.string().min(1).regex(
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  "Skill names may contain only letters, numbers, dots, underscores, and hyphens"
);
const frontmatterSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
}).passthrough();
const frontmatterRecordSchema = z.record(z.unknown());

function discoverFiles(skillDir: string): SkillFile[] {
  const files: SkillFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile()) {
        files.push({
          name: relative(skillDir, path),
          path,
          size: statSync(path).size,
        });
      }
    }
  };
  walk(skillDir);
  return files.sort((left, right) => left.name.localeCompare(right.name));
}

function parseSkill(
  skillDir: string,
  source: SkillSource,
  includeFiles: boolean
): Skill | undefined {
  const path = resolve(skillDir, "SKILL.md");
  if (!existsSync(path)) return undefined;
  try {
    const parsed = matter(readFileSync(path, "utf-8"));
    const metadata = frontmatterSchema.parse(parsed.data);
    const fallbackDescription = parsed.content
      .match(/\*\*Description:\*\*\s*(.+?)(?:\n|$)/)?.[1]
      ?.trim() ?? "";
    return {
      name: metadata.name ?? basename(skillDir),
      description: metadata.description ?? fallbackDescription,
      path,
      source,
      ...(includeFiles ? { files: discoverFiles(skillDir) } : {}),
    };
  } catch {
    return undefined;
  }
}

function scanDirectory(
  root: string,
  source: SkillSource,
  includeFiles: boolean
): Skill[] {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const skill = parseSkill(join(root, entry.name), source, includeFiles);
        return skill ? [skill] : [];
      });
  } catch {
    return [];
  }
}

function matchesFilter(skill: Skill, filter: SkillFilter): boolean {
  if (filter.names && !filter.names.includes(skill.name)) return false;
  if (filter.sources && !filter.sources.includes(skill.source)) return false;
  return true;
}

function writeSkillFile(path: string, content: string, metadata: Record<string, unknown>): void {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, matter.stringify(content, metadata), "utf-8");
  renameSync(temporaryPath, path);
}

export class FileSkillStore implements SkillStore {
  list(x: Context, args: SkillListArgs): Skill[] {
    if (args.names?.length === 0 || args.sources?.length === 0) return [];
    const merged = new Map<string, Skill>();
    for (const skill of scanDirectory(
      xBuiltinSkillsDir(x),
      "builtin",
      args.includeFiles === true
    )) {
      merged.set(skill.name, skill);
    }
    for (const skill of scanDirectory(
      xSkillsDir(x),
      "user",
      args.includeFiles === true
    )) {
      merged.set(skill.name, skill);
    }
    return [...merged.values()]
      .filter((skill) => matchesFilter(skill, args))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  count(x: Context, args: SkillFilter): number {
    return this.list(x, args).length;
  }

  create(x: Context, args: CreateSkillArgs): Skill {
    const name = skillNameSchema.parse(args.name);
    const skillDir = resolve(xSkillsDir(x), name);
    const path = join(skillDir, "SKILL.md");
    if (existsSync(path)) throw new Error(`Skill already exists: ${name}`);
    mkdirSync(skillDir, { recursive: true });
    writeSkillFile(path, args.content ?? "", {
      name,
      description: args.description,
    });
    const created = parseSkill(skillDir, "user", false);
    if (!created) throw new Error(`Failed to create skill: ${name}`);
    return created;
  }

  update(x: Context, args: UpdateSkillArgs): Skill {
    const existing = this.list(x, { names: [args.name] })[0];
    if (!existing) throw new StoreRecordNotFoundError(`Skill not found: ${args.name}`);
    if (existing.source === "builtin") {
      throw new StorePermissionDeniedError(`Built-in skill is read-only: ${args.name}`);
    }

    const parsed = matter(readFileSync(existing.path, "utf-8"));
    const metadata = frontmatterRecordSchema.parse(parsed.data);
    writeSkillFile(
      existing.path,
      args.changes.content ?? parsed.content,
      {
        ...metadata,
        name: existing.name,
        description: args.changes.description ?? existing.description,
      }
    );
    const updated = parseSkill(dirname(existing.path), "user", false);
    if (!updated) throw new Error(`Failed to update skill: ${args.name}`);
    return updated;
  }

  delete(x: Context, args: DeleteSkillArgs): number {
    const skills = this.list(x, { names: args.names });
    const builtin = skills.find((skill) => skill.source === "builtin");
    if (builtin) {
      throw new StorePermissionDeniedError(`Built-in skill is read-only: ${builtin.name}`);
    }

    let deleted = 0;
    for (const skill of skills) {
      rmSync(dirname(skill.path), { recursive: true, force: true });
      deleted++;
    }
    return deleted;
  }

  cmd(_x: Context, _command: never): never {
    throw new UnsupportedStoreOperationError("SkillStore has no commands");
  }
}
