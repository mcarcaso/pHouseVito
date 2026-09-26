#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

const [stageArg, liveArg] = process.argv.slice(2);
if (!stageArg || !liveArg)
  throw new Error("Usage: publish-mobile-web.mjs <staged-dist> <live-dist>");
const stage = resolve(stageArg);
const live = resolve(liveArg);
if (stage === live || stage.startsWith(`${live}${sep}`) || live.startsWith(`${stage}${sep}`)) {
  throw new Error("Staging and live directories must be separate");
}
const index = join(stage, "index.html");
if (!existsSync(index) || !statSync(index).isFile() || statSync(index).size === 0) {
  throw new Error("Staged index.html is missing or empty");
}

function ensureDirectory(directory) {
  if (existsSync(directory)) {
    if (!lstatSync(directory).isDirectory()) throw new Error(`Not a real directory: ${directory}`);
    return;
  }
  ensureDirectory(dirname(directory));
  mkdirSync(directory);
}

function publishFile(relative) {
  const target = join(live, relative);
  ensureDirectory(dirname(target));
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    copyFileSync(join(stage, relative), temporary);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

let count = 0;
function publishDirectory(relative) {
  const directory = join(stage, relative);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(relative, entry.name);
    if (path === "index.html") continue;
    if (entry.isDirectory()) publishDirectory(path);
    else if (entry.isFile()) {
      publishFile(path);
      count++;
    } else throw new Error(`Unsupported staged asset type: ${path}`);
  }
}

publishDirectory("");
publishFile("index.html");
console.log(`Published ${count} assets, then index.html; previous hashed assets retained.`);
