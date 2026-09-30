import { writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { runApplyWorker } from "./update-apply.js";
const [root, stage, revision] = process.argv.slice(2);
if (!root || !stage || !revision) throw new Error("Missing worker arguments");
// Detached supervisor survives the server stopping. No external delivery from this worker.
try {
  await new Promise((done) => setTimeout(done, 2500));
  await runApplyWorker(root, stage, revision);
} catch (error) {
  console.error("Update supervisor:", error);
  // Keep the detailed lifecycle state (including rolled-back/recovery-required).
  await writeFile(join(root, "data/update-error.txt"), String(error), { mode: 0o600 });
  const state = JSON.parse(
    await readFile(join(root, "data/update-status.json"), "utf8").catch(() => "{}"),
  );
  if (state.state === "queued") {
    await writeFile(
      join(root, "data/update-status.json"),
      JSON.stringify({ ...state, state: "failed-before-activation", message: String(error) }),
      { mode: 0o600 },
    );
    await rm(join(root, "data/update-lock"), { recursive: true, force: true });
  }
  process.exitCode = 1;
}
