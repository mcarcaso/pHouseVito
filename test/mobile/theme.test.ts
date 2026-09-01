import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const mobileRoot = path.resolve("mobile");
const isThemeModule = (file: string) =>
  file.endsWith("/src/theme.tsx") || file.endsWith("/src/contexts/theme.tsx");

async function tsxFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory())
        return entry.name === "node_modules" || entry.name === "dist" ? [] : tsxFiles(target);
      return entry.isFile() && entry.name.endsWith(".tsx") ? [target] : [];
    }),
  );
  return nested.flat();
}

describe("mobile UI boundaries", () => {
  it("keeps component colors in the theme rather than inline hex literals", async () => {
    const files = (await tsxFiles(mobileRoot)).filter((file) => !isThemeModule(file));
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/#[\da-f]{6,8}\b/i.test(source)) violations.push(path.relative(mobileRoot, file));
    }
    assert.deepEqual(violations, []);
  });

  it("keeps component spacing on named theme tokens", async () => {
    const files = (await tsxFiles(mobileRoot)).filter((file) => !isThemeModule(file));
    const inlineSpacing =
      /\b(?:padding|paddingTop|paddingBottom|paddingLeft|paddingRight|paddingHorizontal|paddingVertical|margin|marginTop|marginBottom|marginLeft|marginRight|marginHorizontal|marginVertical|gap|rowGap|columnGap):\s*\d+\b/;
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (inlineSpacing.test(source)) violations.push(path.relative(mobileRoot, file));
    }
    assert.deepEqual(violations, []);
  });

  it("centralizes native toolbar buttons in the shared 44-point primitive", async () => {
    const primitive = path.join(mobileRoot, "src/components/navigation/HeaderToolbarButton.tsx");
    const primitiveSource = await readFile(primitive, "utf8");
    assert.match(primitiveSource, /width:\s*44/);
    assert.match(primitiveSource, /height:\s*44/);
    assert.match(primitiveSource, /alignItems:\s*"center"/);
    assert.match(primitiveSource, /justifyContent:\s*"center"/);

    const violations: string[] = [];
    for (const file of await tsxFiles(mobileRoot)) {
      if (file === primitive) continue;
      const source = await readFile(file, "utf8");
      if (source.includes("@react-navigation/elements")) {
        violations.push(`${path.relative(mobileRoot, file)} imports the raw header primitive`);
      }
      if (/headerRight\s*:\s*\([^)]*\)\s*=>\s*\(\s*<Pressable/.test(source)) {
        violations.push(`${path.relative(mobileRoot, file)} uses a bare header-right Pressable`);
      }
    }
    assert.deepEqual(violations, []);
  });
});
