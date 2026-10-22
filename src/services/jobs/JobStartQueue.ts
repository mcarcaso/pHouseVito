/** Local operator handoff: execute in the running server, never a second Pi runtime. */
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readdirSync,
  renameSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const requestSchema = z
  .object({ name: z.string().min(1), requestedAt: z.string().datetime() })
  .strict();
export function enqueueJobStart(userDir: string, name: string): string {
  const dir = join(userDir, "jobs", "start-requests");
  mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  const temp = join(dir, `${id}.tmp`);
  writeFileSync(temp, JSON.stringify({ name, requestedAt: new Date().toISOString() }), {
    flag: "wx",
    mode: 0o600,
  });
  renameSync(temp, join(dir, `${id}.json`));
  return id;
}
export function consumeJobStarts(
  userDir: string,
  start: (name: string, requestedAt: string) => void,
): void {
  const dir = join(userDir, "jobs", "start-requests");
  mkdirSync(dir, { recursive: true });
  for (const file of readdirSync(dir)) {
    if (!/^[a-f0-9-]+\.json$/.test(file)) continue;
    const path = join(dir, file);
    const claimed = `${path}.claimed`;
    try {
      renameSync(path, claimed);
    } catch {
      continue;
    }
    // Claimed requests are deliberately not replayed after a crash.
    try {
      const request = requestSchema.parse(JSON.parse(readFileSync(claimed, "utf8")));
      start(request.name, request.requestedAt);
      unlinkSync(claimed);
    } catch (error) {
      console.error(`[Jobs] Start request ${file} failed:`, error);
    }
  }
}
