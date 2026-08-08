import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { z } from "zod";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { createSkillRouter } from "../../src/routers/skills/skill-router.js";
import { FileSkillStore } from "../../src/stores/skills/FileSkillStore.js";

const root = mkdtempSync(join(tmpdir(), "vito-skill-router-"));
const builtinSkillsDir = join(root, "builtin");
const skillsDir = join(root, "user");
const skillDir = join(skillsDir, "example");
mkdirSync(builtinSkillsDir, { recursive: true });
mkdirSync(skillDir, { recursive: true });
writeFileSync(
  join(skillDir, "SKILL.md"),
  "---\nname: example\ndescription: Example skill\n---\n# Example\n"
);
writeFileSync(join(skillDir, "script.ts"), "export {};\n");

const x = new ObjectContext({
  builtinSkillsDir: () => builtinSkillsDir,
  skillsDir: () => skillsDir,
  skillStore: () => new FileSkillStore(),
});
const app = express();
app.use(express.json());
app.use("/api/skills", createSkillRouter(x));

const skillSchema = z.object({
  name: z.string(),
  description: z.string(),
  source: z.enum(["builtin", "user"]),
  path: z.string(),
});
const fileSchema = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number(),
});

let server: Server;
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  rmSync(root, { recursive: true, force: true });
});

describe("skill router", () => {
  it("lists skills from the context store", async () => {
    const response = await fetch(`${baseUrl}/api/skills`);
    assert.equal(response.status, 200);
    const skills = z.array(skillSchema).parse(await response.json());
    assert.equal(skills.length, 1);
    assert.equal(skills[0]?.name, "example");
    assert.equal(skills[0]?.source, "user");
  });

  it("lists files through the aggregate include flag", async () => {
    const response = await fetch(`${baseUrl}/api/skills/example/files`);
    assert.equal(response.status, 200);
    const files = z.array(fileSchema).parse(await response.json());
    assert.deepEqual(files.map((file) => file.name), ["script.ts", "SKILL.md"]);
  });

  it("returns 404 for unknown skills", async () => {
    const response = await fetch(`${baseUrl}/api/skills/missing/files`);
    assert.equal(response.status, 404);
  });
});
