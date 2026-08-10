import { execFileSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { Context } from "../../context/Context.js";
import {
  driveDirectoryMetaSchema,
  drivePathSchema,
  driveReadCommandSchema,
  nonRootDrivePathSchema,
  type DriveDirectoryMeta,
} from "../../lib/types/drive.js";
import { xDriveDir } from "../../lib/x.js";
import { StoreRecordNotFoundError } from "../Store.js";
import type {
  CreateDriveEntryArgs,
  DeleteDriveEntryArgs,
  DriveEntry,
  DriveFilter,
  DriveListArgs,
  DriveStore,
  UpdateDriveEntryArgs,
} from "./DriveStore.js";

const MAX_EXTRACTED_SITE_BYTES = 500 * 1024 * 1024;
const directoryMetaPatchSchema = z
  .object({
    isPublic: z.boolean().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();

export class InvalidDrivePathError extends Error {
  constructor(message = "Invalid drive path") {
    super(message);
    this.name = "InvalidDrivePathError";
  }
}

export class InvalidDriveArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDriveArchiveError";
  }
}

function parentPath(path: string): string | null {
  if (path === "") return null;
  const parent = posix.dirname(path);
  return parent === "." ? "" : parent;
}

function readMeta(directory: string): DriveDirectoryMeta | null {
  const path = join(directory, ".meta.json");
  if (!existsSync(path)) return null;
  try {
    return driveDirectoryMetaSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return null;
  }
}

function writeMeta(directory: string, meta: DriveDirectoryMeta): void {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, ".meta.json");
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, JSON.stringify(meta, null, 2), { encoding: "utf-8", mode: 0o600 });
  renameSync(temporaryPath, path);
}

function isPublic(root: string, absolutePath: string): boolean {
  const stats = lstatSync(absolutePath);
  const fileName = stats.isFile() ? basename(absolutePath) : undefined;
  let directory = fileName ? dirname(absolutePath) : absolutePath;
  let immediate = true;

  while (directory === root || directory.startsWith(`${root}${sep}`)) {
    const metaPath = join(directory, ".meta.json");
    if (existsSync(metaPath)) {
      let meta: DriveDirectoryMeta;
      try {
        meta = driveDirectoryMetaSchema.parse(JSON.parse(readFileSync(metaPath, "utf-8")));
      } catch {
        return false;
      }
      if (fileName && immediate && meta.files?.[fileName]) {
        return meta.files[fileName].isPublic;
      }
      return meta.isPublic === true;
    }
    if (directory === root) break;
    immediate = false;
    directory = dirname(directory);
  }
  return false;
}

function assertNoMetadataPath(path: string): void {
  if (path.split("/").includes(".meta.json")) {
    throw new InvalidDrivePathError("Drive metadata files cannot be modified directly");
  }
}

function resolveDrivePath(rootInput: string, pathInput: string, requireExisting: boolean): string {
  const parsed = drivePathSchema.safeParse(pathInput);
  if (!parsed.success) throw new InvalidDrivePathError();
  const root = resolve(rootInput);
  mkdirSync(root, { recursive: true });
  const path = resolve(root, parsed.data);
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new InvalidDrivePathError();

  const relativePath = relative(root, path);
  let current = root;
  for (const segment of relativePath ? relativePath.split(sep) : []) {
    current = join(current, segment);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw new InvalidDrivePathError("Symbolic links are not allowed in drive paths");
    }
  }
  if (requireExisting && !existsSync(path))
    throw new StoreRecordNotFoundError("Drive entry not found");
  return path;
}

function entryFromPath(root: string, path: string, absolutePath: string): DriveEntry | undefined {
  if (!existsSync(absolutePath)) return undefined;
  const stats = lstatSync(absolutePath);
  if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) return undefined;
  const kind = stats.isDirectory() ? "directory" : "file";
  return {
    path,
    parentPath: parentPath(path),
    name: path === "" ? "" : posix.basename(path),
    kind,
    size: kind === "file" ? stats.size : 0,
    createdAt: stats.birthtime.toISOString(),
    isPublic: isPublic(root, absolutePath),
    ...(kind === "directory" ? { meta: readMeta(absolutePath) } : {}),
  };
}

function walkEntries(
  root: string,
  directory: string,
  prefix: string,
  recursive: boolean,
): DriveEntry[] {
  const entries: DriveEntry[] = [];
  for (const child of readdirSync(directory, { withFileTypes: true })) {
    if (child.name === ".meta.json" || child.isSymbolicLink()) continue;
    const path = prefix ? `${prefix}/${child.name}` : child.name;
    const absolutePath = join(directory, child.name);
    const entry = entryFromPath(root, path, absolutePath);
    if (!entry) continue;
    entries.push(entry);
    if (recursive && entry.kind === "directory") {
      entries.push(...walkEntries(root, absolutePath, path, true));
    }
  }
  return entries;
}

function matches(entry: DriveEntry, filter: DriveFilter): boolean {
  if (filter.paths && !filter.paths.includes(entry.path)) return false;
  if (
    filter.parentPaths &&
    (entry.parentPath === null || !filter.parentPaths.includes(entry.parentPath))
  ) {
    return false;
  }
  if (filter.kinds && !filter.kinds.includes(entry.kind)) return false;
  return true;
}

function validateArchiveEntries(archivePath: string): void {
  let output: string;
  try {
    output = execFileSync("unzip", ["-Z1", archivePath], {
      encoding: "utf-8",
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    throw new InvalidDriveArchiveError("Failed to inspect zip file");
  }
  for (const rawName of output.split("\n").filter(Boolean)) {
    const name = rawName.endsWith("/") ? rawName.slice(0, -1) : rawName;
    if (!name || !drivePathSchema.safeParse(name).success) {
      throw new InvalidDriveArchiveError("Zip file contains an unsafe path");
    }
  }

  try {
    const listing = execFileSync("unzip", ["-Z", "-l", archivePath], {
      encoding: "utf-8",
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const size = listing.match(/([0-9]+) bytes uncompressed/)?.[1];
    if (!size || Number(size) > MAX_EXTRACTED_SITE_BYTES) {
      throw new InvalidDriveArchiveError("Extracted site is too large");
    }
  } catch (error) {
    if (error instanceof InvalidDriveArchiveError) throw error;
    throw new InvalidDriveArchiveError("Failed to inspect zip file size");
  }
}

function inspectExtractedSite(directory: string): void {
  let totalBytes = 0;
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      const stats = lstatSync(child);
      if (stats.isSymbolicLink())
        throw new InvalidDriveArchiveError("Site archives cannot contain symbolic links");
      if (stats.isDirectory()) walk(child);
      else if (stats.isFile()) totalBytes += stats.size;
      if (totalBytes > MAX_EXTRACTED_SITE_BYTES) {
        throw new InvalidDriveArchiveError("Extracted site is too large");
      }
    }
  };
  walk(directory);
}

function flattenSingleRoot(directory: string): void {
  const entries = readdirSync(directory, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory()) return;
  const childDirectory = join(directory, entries[0].name);
  for (const child of readdirSync(childDirectory)) {
    renameSync(join(childDirectory, child), join(directory, child));
  }
  rmSync(childDirectory, { recursive: true, force: true });
}

export class FileDriveStore implements DriveStore {
  list(x: Context, args: DriveListArgs): DriveEntry[] {
    const root = resolve(xDriveDir(x));
    mkdirSync(root, { recursive: true });
    let entries: DriveEntry[] = [];

    if (args.paths) {
      for (const path of new Set(args.paths)) {
        let absolutePath: string;
        try {
          absolutePath = resolveDrivePath(root, path, false);
        } catch {
          continue;
        }
        const entry = entryFromPath(root, path, absolutePath);
        if (entry) entries.push(entry);
      }
    } else if (args.parentPaths) {
      for (const path of new Set(args.parentPaths)) {
        let directory: string;
        try {
          directory = resolveDrivePath(root, path, true);
        } catch {
          continue;
        }
        if (!lstatSync(directory).isDirectory()) continue;
        entries.push(...walkEntries(root, directory, path, false));
      }
    } else {
      const rootEntry = entryFromPath(root, "", root);
      if (rootEntry) entries.push(rootEntry);
      entries.push(...walkEntries(root, root, "", true));
    }

    entries = entries.filter((entry) => matches(entry, args));
    return entries.sort((left, right) =>
      args.order === "created"
        ? left.createdAt.localeCompare(right.createdAt) || left.path.localeCompare(right.path)
        : left.name.localeCompare(right.name) || left.path.localeCompare(right.path),
    );
  }

  count(x: Context, args: DriveFilter): number {
    return this.list(x, args).length;
  }

  create(x: Context, args: CreateDriveEntryArgs): DriveEntry {
    const path = nonRootDrivePathSchema.parse(args.path);
    assertNoMetadataPath(path);
    const root = resolve(xDriveDir(x));
    const target = resolveDrivePath(root, path, false);

    if (args.kind === "directory") {
      mkdirSync(target, { recursive: true });
    } else if (args.kind === "file") {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, args.content);
    } else {
      this.createSite(root, path, target, args.archive);
    }

    const created = entryFromPath(root, path, target);
    if (!created) throw new Error(`Failed to create drive entry: ${path}`);
    return created;
  }

  private createSite(root: string, path: string, target: string, archive: Buffer): void {
    mkdirSync(root, { recursive: true });
    const workDirectory = mkdtempSync(join(root, ".site-upload-"));
    const archivePath = join(workDirectory, "upload.zip");
    const extractedDirectory = join(workDirectory, "extracted");
    let backupPath: string | undefined;
    try {
      writeFileSync(archivePath, archive, { mode: 0o600 });
      validateArchiveEntries(archivePath);
      mkdirSync(extractedDirectory);
      execFileSync("unzip", ["-o", archivePath, "-d", extractedDirectory], {
        timeout: 30_000,
        stdio: "ignore",
      });
      inspectExtractedSite(extractedDirectory);
      flattenSingleRoot(extractedDirectory);
      if (!existsSync(join(extractedDirectory, "index.html"))) {
        throw new InvalidDriveArchiveError("Site zip must contain an index.html");
      }

      if (existsSync(target)) {
        const existingMeta = readMeta(target);
        if (existingMeta) writeMeta(extractedDirectory, existingMeta);
        backupPath = `${target}.backup-${process.pid}-${Date.now()}`;
        renameSync(target, backupPath);
      }
      mkdirSync(dirname(target), { recursive: true });
      renameSync(extractedDirectory, target);
      if (backupPath) rmSync(backupPath, { recursive: true, force: true });
    } catch (error) {
      if (backupPath && existsSync(backupPath) && !existsSync(target))
        renameSync(backupPath, target);
      if (error instanceof InvalidDriveArchiveError) throw error;
      throw new InvalidDriveArchiveError("Failed to extract zip file");
    } finally {
      rmSync(workDirectory, { recursive: true, force: true });
    }
  }

  update(x: Context, args: UpdateDriveEntryArgs): DriveEntry {
    const path = drivePathSchema.parse(args.path);
    assertNoMetadataPath(path);
    const root = resolve(xDriveDir(x));

    if ("directoryMeta" in args.changes) {
      const directory = resolveDrivePath(root, path, false);
      if (existsSync(directory) && !lstatSync(directory).isDirectory()) {
        throw new InvalidDrivePathError("Directory metadata requires a directory path");
      }
      mkdirSync(directory, { recursive: true });
      const patch = directoryMetaPatchSchema.parse(args.changes.directoryMeta);
      writeMeta(directory, { ...(readMeta(directory) ?? {}), ...patch });
    } else {
      const file = resolveDrivePath(root, path, true);
      if (!lstatSync(file).isFile()) throw new StoreRecordNotFoundError("Drive file not found");
      const directory = dirname(file);
      const name = basename(file);
      const meta = readMeta(directory) ?? {};
      const files = { ...(meta.files ?? {}) };
      if (args.changes.fileIsPublic === null) delete files[name];
      else files[name] = { isPublic: args.changes.fileIsPublic };
      writeMeta(directory, {
        ...meta,
        ...(Object.keys(files).length > 0 ? { files } : { files: undefined }),
      });
    }

    const updated = entryFromPath(root, path, resolveDrivePath(root, path, true));
    if (!updated) throw new StoreRecordNotFoundError("Drive entry not found");
    return updated;
  }

  delete(x: Context, args: DeleteDriveEntryArgs): number {
    const root = resolve(xDriveDir(x));
    let deleted = 0;
    for (const path of new Set(args.paths)) {
      const parsed = nonRootDrivePathSchema.safeParse(path);
      if (!parsed.success) continue;
      let target: string;
      try {
        target = resolveDrivePath(root, parsed.data, true);
      } catch {
        continue;
      }
      rmSync(target, { recursive: true, force: true });
      deleted++;
    }
    return deleted;
  }

  cmd(x: Context, command: unknown): unknown {
    const parsed = driveReadCommandSchema.safeParse(command);
    if (!parsed.success) return undefined;
    const root = resolve(xDriveDir(x));
    let path = parsed.data.path;
    let target: string;
    try {
      target = resolveDrivePath(root, path, true);
    } catch {
      return undefined;
    }
    if (lstatSync(target).isDirectory()) {
      if (!parsed.data.indexFallback) return undefined;
      path = path ? `${path}/index.html` : "index.html";
      try {
        target = resolveDrivePath(root, path, true);
      } catch {
        return undefined;
      }
    }
    const entry = entryFromPath(root, path, target);
    if (!entry || entry.kind !== "file") return undefined;
    return {
      path: entry.path,
      name: entry.name,
      size: entry.size,
      isPublic: entry.isPublic,
      stream: createReadStream(target),
    };
  }
}
