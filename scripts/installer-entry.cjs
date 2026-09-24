// Node SEA installer entry. Only Node built-ins: installer payloads are SEA assets.
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { getAsset } = require("node:sea");

const manifest = JSON.parse(Buffer.from(getAsset("manifest.json")).toString("utf8"));
const files = [
  "install-release.sh",
  "manage-release.sh",
  "validate-release-archive.py",
  manifest.archive,
  `${manifest.archive}.sha256`,
];
function run(binary, args) {
  const result = spawnSync(binary, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${binary} terminated by ${result.signal}`);
  if (result.status !== 0) throw new Error(`${binary} exited with ${result.status}`);
}
function capture(binary, args) {
  const result = spawnSync(binary, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`${binary} unavailable`);
  return result.stdout.trim();
}
function doctor() {
  if (`${process.platform}-${process.arch}` !== manifest.platform) {
    throw new Error(
      `Installer is for ${manifest.platform}, not ${process.platform}-${process.arch}`,
    );
  }
  for (const command of ["bash", "tar", "python3", "shasum", "node"]) capture("which", [command]);
  const version = capture("node", ["-p", "process.versions.node"]);
  const [major, minor] = version.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 19)) {
    throw new Error(`Node >=22.19 is required; found ${version}`);
  }
  if (major !== manifest.nodeMajor) {
    throw new Error(`Release requires Node major ${manifest.nodeMajor}; found ${major}`);
  }
  console.log(`Prerequisites OK: ${manifest.platform}, Node ${version}`);
}
function usage() {
  console.error(
    "Usage: vito-installer doctor | install <root> [--activate] | status <root> | verify <root> <version> | activate <root> <version> | rollback <root>",
  );
  process.exitCode = 2;
}
function main() {
  const [action, root, version] = process.argv.slice(2);
  if (action === "doctor" && !root) return doctor();
  if (!root || !["install", "status", "verify", "activate", "rollback"].includes(action)) {
    return usage();
  }
  if (action === "install" && version && version !== "--activate") return usage();
  if (["status", "rollback"].includes(action) && version) return usage();
  if (["verify", "activate"].includes(action) && !version) return usage();
  doctor();
  const temp = mkdtempSync(join(tmpdir(), "vito-installer."));
  try {
    for (const file of files) {
      writeFileSync(join(temp, file), Buffer.from(getAsset(file)), {
        mode: file.endsWith(".sh") || file.endsWith(".py") ? 0o700 : 0o600,
      });
    }
    if (action === "install") {
      run("bash", [
        join(temp, "install-release.sh"),
        join(temp, manifest.archive),
        root,
        ...(version ? [version] : []),
      ]);
    } else {
      run("bash", [join(temp, "manage-release.sh"), root, action, ...(version ? [version] : [])]);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
try {
  main();
} catch (error) {
  console.error(`Installer: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
