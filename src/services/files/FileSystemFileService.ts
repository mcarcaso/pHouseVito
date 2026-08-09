import { createReadStream, existsSync, lstatSync } from "node:fs";
import { basename, extname, isAbsolute, resolve } from "node:path";
import type { Context } from "../../context/Context.js";
import type { FileService, ReadableFile } from "./FileService.js";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".xml": "application/xml",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".exe": "application/octet-stream",
  ".dmg": "application/octet-stream",
};
const DOWNLOAD_EXTENSIONS = new Set([".zip", ".tar", ".gz", ".exe", ".dmg"]);

export class FileSystemFileService implements FileService {
  read(_x: Context, pathInput: string): ReadableFile | undefined {
    const path = isAbsolute(pathInput) ? pathInput : resolve(pathInput);
    if (!existsSync(path)) return undefined;
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink()) return undefined;
    const extension = extname(path).toLowerCase();
    return {
      name: basename(path),
      size: stats.size,
      mimeType: MIME_TYPES[extension] ?? "application/octet-stream",
      disposition: DOWNLOAD_EXTENSIONS.has(extension) ? "attachment" : "inline",
      stream: createReadStream(path),
    };
  }
}
