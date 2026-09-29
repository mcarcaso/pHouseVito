import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { verifyUpdateManifest, verifyAsset } from "../../src/cli/update-manifest.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const key = publicKey.export({ type: "spki", format: "pem" }).toString();
const bytes = Buffer.from("installer bytes");
const asset = {
  platform: "darwin-arm64",
  nodeMajor: 24,
  file: "vito-installer-v1-darwin-arm64",
  url: "https://github.com/mcarcaso/pHouseVito/releases/download/v1/vito-installer-v1-darwin-arm64",
  sha256: createHash("sha256").update(bytes).digest("hex"),
  size: bytes.length,
};
function signed(changes: Record<string, unknown> = {}) {
  const raw = Buffer.from(
    JSON.stringify({
      schema: 1,
      version: "v1",
      revision: "a".repeat(40),
      assets: [asset],
      ...changes,
    }),
  );
  return { raw, signature: sign(null, raw, privateKey).toString("base64") };
}
test("accepts exact signed manifest and matching bytes", () => {
  const { raw, signature } = signed();
  assert.equal(verifyUpdateManifest(raw, signature, key).version, "v1");
  verifyAsset(bytes, asset.sha256, bytes.length);
});
test("rejects changed manifest and installer", () => {
  const { raw, signature } = signed();
  assert.throws(
    () => verifyUpdateManifest(Buffer.concat([raw, Buffer.from(" ")]), signature, key),
    /signature/,
  );
  assert.throws(() => verifyAsset(Buffer.from("wrong"), asset.sha256, bytes.length), /mismatch/);
});
test("rejects signed untrusted URL, duplicate platforms and invalid signature encoding", () => {
  const evil = signed({ assets: [{ ...asset, url: "https://evil.example/installer" }] });
  assert.throws(() => verifyUpdateManifest(evil.raw, evil.signature, key), /Untrusted/);
  const duplicate = signed({ assets: [asset, asset] });
  assert.throws(() => verifyUpdateManifest(duplicate.raw, duplicate.signature, key), /Duplicate/);
  assert.throws(() => verifyUpdateManifest(signed().raw, "oops", key), /encoding/);
});
