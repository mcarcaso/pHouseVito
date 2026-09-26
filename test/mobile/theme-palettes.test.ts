import assert from "node:assert/strict";
import { describe, it } from "node:test";
import paletteModule from "../../mobile/src/contexts/theme-palettes.ts";
const { paletteNames, themes, legacyNames, resolveThemePreferences } = paletteModule;

function luminance(hex: string) {
  const raw = hex.replace("#", "");
  const expanded = raw.length === 3 ? [...raw].map((part) => part + part).join("") : raw;
  const channels = expanded.match(/.{2}/g);
  assert.ok(channels && channels.length === 3, `Expected a six-digit color: ${hex}`);
  const [r, g, b] = channels.map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("theme palette families", () => {
  it("offers a distinct light and dark variant for every palette", () => {
    assert.equal(paletteNames.length, 22);
    assert.deepEqual(Object.keys(themes), [...paletteNames]);
    for (const name of paletteNames) {
      assert.equal(themes[name].light.name, name);
      assert.equal(themes[name].dark.name, name);
      assert.equal(themes[name].light.dark, false);
      assert.equal(themes[name].dark.dark, true);
      assert.notEqual(themes[name].light.colors.canvas, themes[name].dark.colors.canvas);
    }
  });

  it("keeps every old saved theme on the same variant", () => {
    assert.equal(Object.keys(legacyNames).length, 15);
    for (const [oldName, { palette, appearance }] of Object.entries(legacyNames)) {
      assert.deepEqual(resolveThemePreferences(null, null, oldName), { palette, appearance });
      assert.equal(themes[palette][appearance].name, palette);
    }
    assert.deepEqual(resolveThemePreferences("ocean", "system", "ledger-dark"), {
      palette: "ocean",
      appearance: "system",
    });
    assert.deepEqual(resolveThemePreferences("constructor", "invalid", "paper"), {
      palette: "paper",
      appearance: "light",
    });
  });

  it("keeps body text and control labels readable in all 44 variants", () => {
    const failures: string[] = [];
    for (const name of paletteNames)
      for (const mode of ["light", "dark"] as const) {
        const c = themes[name][mode].colors;
        for (const [label, foreground, background] of [
          ["canvas text", c.text, c.canvas],
          ["surface text", c.text, c.surface],
          ["secondary text", c.textSecondary, c.surface],
          ["accent labels", c.accent, c.surface],
          ["accent buttons", c.accentText, c.accent],
        ]) {
          if (contrast(foreground, background) < 4.5)
            failures.push(
              `${name}/${mode} ${label}: ${contrast(foreground, background).toFixed(2)}`,
            );
        }
      }
    assert.deepEqual(failures, []);
  });
});
