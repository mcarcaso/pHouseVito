import { createPublicKey, createHash, verify } from "node:crypto";
import { basename } from "node:path";
import { z } from "zod";
import { UPDATE_PUBLIC_KEY } from "./update-public-key.js";

const assetSchema = z
  .object({
    platform: z.enum(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]),
    nodeMajor: z.number().int().positive(),
    file: z.string().regex(/^vito-installer-[A-Za-z0-9._-]+-(?:darwin|linux)-(?:arm64|x64)$/),
    url: z.string().url(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z
      .number()
      .int()
      .positive()
      .max(1024 * 1024 * 1024),
  })
  .strict();
const fields = {
  version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  assets: z.array(assetSchema).min(1).max(4),
};
const backupFile = z.enum([
  "vito.db",
  "embeddings.db",
  "vito.config.json",
  "secrets.json",
  "SOUL.md",
  "profile.md",
  "profile.json",
]);
export const dataImpactSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("compatible-migration"),
      files: z.array(backupFile).min(1),
      notes: z.string().min(1).max(4000),
      backwardCompatible: z.literal(true),
    })
    .strict(),
  z.object({ kind: z.literal("breaking"), notes: z.string().min(1).max(4000) }).strict(),
]);
export const updateManifestSchema = z.discriminatedUnion("schema", [
  z.object({ schema: z.literal(1), ...fields }).strict(),
  z
    .object({
      schema: z.literal(2),
      ...fields,
      sequence: z.number().int().positive(),
      dataImpact: dataImpactSchema,
    })
    .strict(),
]);
export type UpdateManifest = z.infer<typeof updateManifestSchema>;

export function verifyUpdateManifest(
  raw: Buffer,
  signature: string,
  publicKey = UPDATE_PUBLIC_KEY,
): UpdateManifest {
  if (raw.length > 64 * 1024) throw new Error("Manifest exceeds 64 KiB");
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signature)) throw new Error("Invalid signature encoding");
  if (!verify(null, raw, createPublicKey(publicKey), Buffer.from(signature, "base64")))
    throw new Error("Update manifest signature verification failed");
  const manifest = updateManifestSchema.parse(JSON.parse(raw.toString("utf8")));
  const platforms = manifest.assets.map((a) => a.platform);
  if (new Set(platforms).size !== platforms.length) throw new Error("Duplicate platform asset");
  for (const asset of manifest.assets) {
    const url = new URL(asset.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hostname !== "github.com" ||
      !url.pathname.startsWith(`/mcarcaso/pHouseVito/releases/download/`) ||
      basename(url.pathname) !== asset.file
    )
      throw new Error(`Untrusted update URL for ${asset.platform}`);
  }
  return manifest;
}
export function verifyAsset(bytes: Buffer, sha256: string, size: number): void {
  if (bytes.length !== size || createHash("sha256").update(bytes).digest("hex") !== sha256)
    throw new Error("Installer size or SHA-256 mismatch");
}
