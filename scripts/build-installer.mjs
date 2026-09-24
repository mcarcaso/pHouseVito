#!/usr/bin/env node
// Local unsigned Node SEA installer prototype. Distribution signing is separate.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const archive = process.argv[2] && resolve(process.argv[2]);
const output = process.argv[3] && resolve(process.argv[3]);
if (!archive || !output)
  throw new Error("Usage: build-installer.mjs <release.tar.gz> <output executable>");
if (!existsSync(archive) || !existsSync(`${archive}.sha256`) || existsSync(output)) {
  throw new Error("Release archive/checksum must exist; output must not exist");
}
const filename = basename(archive);
const match = /^vito-(.+)-(darwin|linux)-(x64|arm64)\.tar\.gz$/.exec(filename);
if (!match || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(match[1]))
  throw new Error("Invalid release filename");
const platform = `${match[2]}-${match[3]}`;
if (platform !== `${process.platform}-${process.arch}`)
  throw new Error("Build on the target platform/architecture");
const info = execFileSync("tar", ["-xOf", archive, `vito-${match[1]}/RELEASE_INFO`], {
  encoding: "utf8",
});
const nodeMajor = Number(/^Node: v(\d+)/m.exec(info)?.[1]);
if (nodeMajor !== Number(process.versions.node.split(".")[0])) throw new Error("Node ABI mismatch");
if (/^Dirty: 1$/m.test(info) && process.env.ALLOW_DIRTY_INSTALLER !== "1") {
  throw new Error("Dirty local-pilot release cannot be wrapped for distribution");
}
execFileSync("shasum", ["-a", "256", "-c", basename(archive) + ".sha256"], {
  cwd: dirname(archive),
  stdio: "pipe",
});
const postject = process.env.POSTJECT_BIN;
if (!postject || !existsSync(postject))
  throw new Error("Set POSTJECT_BIN to a pinned postject CLI (build dependency)");
const temp = mkdtempSync(join(tmpdir(), "vito-installer-build."));
try {
  const dir = dirname(fileURLToPath(import.meta.url));
  const assets = { "manifest.json": join(temp, "manifest.json") };
  writeFileSync(
    assets["manifest.json"],
    JSON.stringify({ archive: filename, platform, nodeMajor }),
  );
  for (const script of ["install-release.sh", "manage-release.sh", "validate-release-archive.py"]) {
    assets[script] = join(dir, script);
  }
  assets[filename] = archive;
  assets[`${filename}.sha256`] = `${archive}.sha256`;
  const config = join(temp, "sea.json");
  writeFileSync(
    config,
    JSON.stringify({
      main: join(dir, "installer-entry.cjs"),
      output: join(temp, "sea.blob"),
      assets,
      disableExperimentalSEAWarning: true,
    }),
  );
  execFileSync(process.execPath, [`--experimental-sea-config=${config}`], { stdio: "inherit" });
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(process.execPath, output);
  if (process.platform === "darwin") execFileSync("codesign", ["--remove-signature", output]);
  const args = [
    output,
    "NODE_SEA_BLOB",
    join(temp, "sea.blob"),
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ];
  if (process.platform === "darwin") args.push("--macho-segment-name", "NODE_SEA");
  execFileSync(postject, args, { stdio: "inherit" });
  if (process.platform === "darwin") execFileSync("codesign", ["--sign", "-", output]);
  console.log(`Local unsigned installer prototype: ${output}`);
} catch (error) {
  rmSync(output, { force: true });
  throw error;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
