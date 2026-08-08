import type { Context } from "../../context/Context.js";
import type { AppMetadata } from "../../contracts/app.js";
import type { Store } from "../Store.js";

export interface AppFile {
  path: string;
  size: number;
  isDir: boolean;
}

export interface App {
  name: string;
  description: string;
  port: number;
  url: string;
  createdAt: string;
  metadata: AppMetadata;
  files?: AppFile[];
}

export interface AppFilter {
  names?: string[];
  urls?: string[];
}

export interface AppListArgs extends AppFilter {
  includeFiles?: boolean;
}

export interface DeleteAppArgs {
  names: string[];
}

export interface AppStore extends Store<
  App,
  AppListArgs,
  never,
  never,
  DeleteAppArgs,
  unknown
> {
  list(x: Context, args: AppListArgs): App[];
  count(x: Context, args: AppFilter): number;
  create(x: Context, args: never): never;
  update(x: Context, args: never): never;
  delete(x: Context, args: DeleteAppArgs): number;
  cmd(x: Context, command: unknown): unknown;
}
