#!/usr/bin/env node
// Sign an exact-byte manifest with an offline Ed25519 private key. Never publish the key.
import { createPrivateKey, sign, createHash } from "node:crypto";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
const [version, revision, privateKeyPath, policyPath, ...paths] = process.argv.slice(2);
if (
  !version ||
  !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version) ||
  !revision ||
  !/^[a-f0-9]{40}$/.test(revision) ||
  !privateKeyPath ||
  !policyPath ||
  !paths.length
)
  throw new Error(
    "Usage: node scripts/sign-update-manifest.mjs VERSION FULL_REVISION PRIVATE_KEY POLICY_JSON INSTALLER...",
  );
const assets = paths.map((input) => {
  const path = resolve(input),
    file = basename(path);
  const match = /^vito-installer-[A-Za-z0-9._-]+-(darwin|linux)-(arm64|x64)$/.exec(file);
  if (!match) throw new Error(`Invalid installer filename: ${file}`);
  const bytes = readFileSync(path);
  if (bytes.length > 1024 * 1024 * 1024) throw new Error("Installer too large");
  return {
    platform: `${match[1]}-${match[2]}`,
    nodeMajor: Number(process.versions.node.split(".")[0]),
    file,
    url: `https://github.com/mcarcaso/pHouseVito/releases/download/${version}/${file}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: statSync(path).size,
  };
});
const policy = JSON.parse(readFileSync(policyPath, "utf8"));
// Validate before signing using the exact schema shipped with the receiver.
const { updateManifestSchema } = await import("../dist/cli/update-manifest.js");
const value = updateManifestSchema.parse({
  schema: 2,
  version,
  revision,
  assets,
  sequence: policy.sequence,
  dataImpact: policy.dataImpact,
});
const manifest = Buffer.from(JSON.stringify(value) + "\n");
const key = createPrivateKey(readFileSync(privateKeyPath));
const signature = sign(null, manifest, key).toString("base64");
writeFileSync("update-manifest.json", manifest, { flag: "wx" });
writeFileSync("update-manifest.sig", signature + "\n", { flag: "wx" });
console.log(
  "Signed manifest created. Publish the manifest, signature, and matching installers in one GitHub release.",
);
