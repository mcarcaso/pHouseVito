import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { Context } from "../../context/Context.js";
import {
  appMetadataSchema,
  appNameSchema,
  appReadFileCommandSchema,
} from "../../shared/schemas/app.js";
import { xAppsDir } from "../../lib/x.js";
import { UnsupportedStoreOperationError } from "../Store.js";
import type {
  App,
  AppFile,
  AppFilter,
  AppListArgs,
  AppStore,
  DeleteAppArgs,
} from "./AppStore.js";

const APP_METADATA_FILE = ".vito-app.json";

export class AppFileTooLargeError extends Error {
  constructor() {
    super("File too large");
    this.name = "AppFileTooLargeError";
  }
}

function resolveAppDirectory(root: string, name: string): string | undefined {
  const parsed = appNameSchema.safeParse(name);
  if (!parsed.success) return undefined;
  const directory = resolve(root, parsed.data);
  if (!directory.startsWith(`${resolve(root)}${sep}`) || !existsSync(directory)) return undefined;
  const stats = lstatSync(directory);
  return stats.isDirectory() && !stats.isSymbolicLink() ? directory : undefined;
}

function resolveAppFile(directory: string, filePath: string): string | undefined {
  const path = resolve(directory, filePath);
  if (!path.startsWith(`${directory}${sep}`)) return undefined;
  const relativePath = relative(directory, path);
  let current = directory;
  for (const segment of relativePath.split(sep)) {
    current = join(current, segment);
    if (!existsSync(current) || lstatSync(current).isSymbolicLink()) return undefined;
  }
  return path;
}

function discoverFiles(directory: string): AppFile[] {
  const files: AppFile[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      if (entry.name.startsWith(".") && entry.name !== APP_METADATA_FILE) continue;
      if (entry.isSymbolicLink()) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) {
        files.push({ path, size: 0, isDir: true });
        walk(absolutePath, path);
      } else if (entry.isFile()) {
        files.push({ path, size: statSync(absolutePath).size, isDir: false });
      }
    }
  };
  walk(directory, "");
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function readApp(root: string, name: string, includeFiles: boolean): App | undefined {
  const directory = resolveAppDirectory(root, name);
  if (!directory) return undefined;
  const metadataPath = join(directory, APP_METADATA_FILE);
  if (!existsSync(metadataPath) || lstatSync(metadataPath).isSymbolicLink()) return undefined;
  try {
    const metadata = appMetadataSchema.parse(JSON.parse(readFileSync(metadataPath, "utf-8")));
    return {
      name,
      description: metadata.description ?? "",
      port: metadata.port,
      url: metadata.url ?? `http://localhost:${metadata.port}`,
      createdAt: metadata.createdAt ?? statSync(metadataPath).birthtime.toISOString(),
      metadata,
      ...(includeFiles ? { files: discoverFiles(directory) } : {}),
    };
  } catch {
    return undefined;
  }
}

function matches(app: App, filter: AppFilter): boolean {
  if (filter.names && !filter.names.includes(app.name)) return false;
  if (filter.urls && !filter.urls.includes(app.url)) return false;
  return true;
}

export class FileAppStore implements AppStore {
  list(x: Context, args: AppListArgs): App[] {
    const root = resolve(xAppsDir(x));
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .flatMap((entry) => {
        const app = readApp(root, entry.name, args.includeFiles === true);
        return app && matches(app, args) ? [app] : [];
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  count(x: Context, args: AppFilter): number {
    return this.list(x, args).length;
  }

  create(_x: Context, _args: never): never {
    throw new UnsupportedStoreOperationError("Apps are created by the app deployment workflow");
  }

  update(_x: Context, _args: never): never {
    throw new UnsupportedStoreOperationError("App metadata is deployment-managed");
  }

  delete(x: Context, args: DeleteAppArgs): number {
    const root = resolve(xAppsDir(x));
    let deleted = 0;
    for (const app of this.list(x, { names: [...new Set(args.names)] })) {
      const directory = resolveAppDirectory(root, app.name);
      if (!directory) continue;
      rmSync(directory, { recursive: true, force: true });
      deleted++;
    }
    return deleted;
  }

  cmd(x: Context, command: unknown): unknown {
    const parsed = appReadFileCommandSchema.safeParse(command);
    if (!parsed.success) return undefined;
    const root = resolve(xAppsDir(x));
    const directory = resolveAppDirectory(root, parsed.data.appName);
    if (!directory) return undefined;
    const path = resolveAppFile(directory, parsed.data.path);
    if (!path) return undefined;
    const stats = lstatSync(path);
    if (!stats.isFile()) return undefined;
    if (stats.size > parsed.data.maxBytes) throw new AppFileTooLargeError();
    return { content: readFileSync(path, "utf-8"), size: stats.size };
  }
}
