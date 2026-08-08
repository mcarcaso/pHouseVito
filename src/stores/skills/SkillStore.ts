import type { Context } from "../../context/Context.js";
import type { Store } from "../Store.js";

export type SkillSource = "builtin" | "user";

export interface SkillFile {
  name: string;
  path: string;
  size: number;
}

export interface Skill {
  name: string;
  description: string;
  path: string;
  source: SkillSource;
  files?: SkillFile[];
}

export interface SkillFilter {
  names?: string[];
  sources?: SkillSource[];
}

export interface SkillListArgs extends SkillFilter {
  includeFiles?: boolean;
}

export interface CreateSkillArgs {
  name: string;
  description: string;
  content?: string;
}

export interface UpdateSkillArgs {
  name: string;
  changes: {
    description?: string;
    content?: string;
  };
}

export interface DeleteSkillArgs {
  names: string[];
}

export interface SkillStore extends Store<
  Skill,
  SkillListArgs,
  CreateSkillArgs,
  UpdateSkillArgs,
  DeleteSkillArgs,
  never
> {
  list(x: Context, args: SkillListArgs): Skill[];
  count(x: Context, args: SkillFilter): number;
  create(x: Context, args: CreateSkillArgs): Skill;
  update(x: Context, args: UpdateSkillArgs): Skill;
  delete(x: Context, args: DeleteSkillArgs): number;
  cmd(x: Context, command: never): never;
}
