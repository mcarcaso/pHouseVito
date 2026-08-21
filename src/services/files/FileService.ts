import type { Readable } from "node:stream";
import type { Context } from "../../context/Context.js";

export interface ReadableFile {
  name: string;
  size: number;
  mimeType: string;
  disposition: "inline" | "attachment";
  stream: Readable;
}

export interface FileService {
  read(x: Context, path: string): ReadableFile | undefined;
}
