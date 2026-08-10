import { readFile, writeFile } from "node:fs/promises";

// Croner 10.0.1 can compute a -1 ms delay at a schedule boundary. Node already
// coerces that delay to 1 ms, but emits TimeoutNegativeWarning first. Preserve
// Node's effective behavior while avoiding the warning.
const files = ["node_modules/croner/dist/croner.js", "node_modules/croner/dist/croner.cjs"];
const original = "setTimeout(()=>this._checkTrigger(r),t)";
const patched = "setTimeout(()=>this._checkTrigger(r),Math.max(1,t))";

for (const file of files) {
  const source = await readFile(file, "utf8");
  if (source.includes(patched)) continue;
  if (!source.includes(original)) {
    throw new Error(`Unable to apply Croner timeout patch to ${file}; upstream code changed`);
  }
  await writeFile(file, source.replace(original, patched));
}
