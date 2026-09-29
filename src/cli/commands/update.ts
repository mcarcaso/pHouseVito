import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import { verifyAsset, verifyUpdateManifest } from "../update-manifest.js";

const RELEASES = "https://github.com/mcarcaso/pHouseVito/releases";
function releaseBase(): string {
  // Explicit test tags use the same signing key and repository, but do not
  // change the production latest-release feed. No arbitrary URL override.
  const tag = process.env.VITO_UPDATE_TEST_TAG;
  if (!tag) return `${RELEASES}/latest/download`;
  if (!/^updater-test-[A-Za-z0-9._-]+$/.test(tag)) throw new Error("Invalid test release tag");
  return `${RELEASES}/download/${tag}`;
}
const MAX_MANIFEST_BYTES = 64 * 1024;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
]);

async function download(url: string, maxBytes: number): Promise<Buffer> {
  let current = new URL(url);
  for (let redirects = 0; redirects < 6; redirects++) {
    if (
      current.protocol !== "https:" ||
      current.username ||
      current.password ||
      !ALLOWED_DOWNLOAD_HOSTS.has(current.hostname)
    )
      throw new Error("Untrusted download host");
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
      headers: { "User-Agent": "pHouseVito-updater" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location");
      if (!next) throw new Error("Redirect missing location");
      current = new URL(next, current);
      continue;
    }
    if (!response.ok) throw new Error(`Update download failed (HTTP ${response.status})`);
    if (Number(response.headers.get("content-length")) > maxBytes)
      throw new Error("Download exceeds limit");
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!response.body) throw new Error("Empty update response");
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) {
        await response.body.cancel().catch(() => {});
        throw new Error("Download exceeds limit");
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error("Too many update redirects");
}

export async function runUpdateCommand(args: string[], projectRoot: string): Promise<number> {
  const [action, ...rest] = args;
  if (action === "help" || action === "--help" || !action) {
    console.log(
      "Usage: vito update check | stage\nStages a signed installer; does not execute, activate, or restart it.",
    );
    return 0;
  }
  if (!["check", "stage"].includes(action) || rest.length)
    throw new Error("Usage: vito update check | stage");
  const base = releaseBase();
  const [manifestBytes, signatureBytes] = await Promise.all([
    download(`${base}/update-manifest.json`, MAX_MANIFEST_BYTES),
    download(`${base}/update-manifest.sig`, 1024),
  ]);
  const manifest = verifyUpdateManifest(manifestBytes, signatureBytes.toString("utf8").trim());
  if (process.env.VITO_UPDATE_TEST_TAG && manifest.version !== process.env.VITO_UPDATE_TEST_TAG)
    throw new Error("Signed manifest version does not match test release tag");
  const platform = `${process.platform}-${process.arch}`;
  const asset = manifest.assets.find((entry) => entry.platform === platform);
  if (!asset) throw new Error(`No signed installer for ${platform}`);
  const major = Number(process.versions.node.split(".")[0]);
  if (asset.nodeMajor !== major)
    throw new Error(`Update requires Node major ${asset.nodeMajor}; found ${major}`);
  const info = await readFile(join(projectRoot, "RELEASE_INFO"), "utf8").catch(() => "");
  const installed = /^Revision: ([a-f0-9]{40})$/m.exec(info)?.[1];
  if (installed === manifest.revision) {
    console.log(`Already running revision ${installed}`);
    return 0;
  }
  if (action === "check") {
    console.log(
      JSON.stringify({
        version: manifest.version,
        revision: manifest.revision,
        platform,
        currentRevision: installed ?? "source-or-unknown",
        installerBytes: asset.size,
      }),
    );
    return 0;
  }
  const dir = resolve(homedir(), ".vito", "updates", manifest.version);
  const target = join(dir, basename(asset.file));
  const bytes = await download(asset.url, asset.size);
  verifyAsset(bytes, asset.sha256, asset.size);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = join(dir, `.download-${randomBytes(8).toString("hex")}`);
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o700 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(
    `Verified and staged: ${target}\nNo installer was executed and no service was restarted.`,
  );
  return 0;
}
