import { cpSync, mkdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error("Usage: copy-release-source.mjs <repo> <snapshot>");
mkdirSync(destination, { recursive: true });
const roots = [
  "src",
  "mobile",
  "system",
  "docs/signed-updates.md",
  "user.example",
  "scripts",
  "packages/vito-client",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
];
for (const root of roots) {
  const from = join(source, root);
  statSync(from); // Fail rather than silently package a partial tree.
  cpSync(from, join(destination, root), {
    recursive: true,
    filter: (path) => {
      const segments = relative(source, path).split(/[\\/]/);
      return !segments.some(
        (part) =>
          part === "node_modules" ||
          part === "dist" ||
          part === "builds" ||
          part === ".expo" ||
          part === "ios" ||
          part === "android" ||
          part === ".git" ||
          part === ".env" ||
          part.startsWith(".env.") ||
          part.endsWith(".db") ||
          part.endsWith(".log"),
      );
    },
  });
}
console.log(`Source snapshot created at ${destination}`);
