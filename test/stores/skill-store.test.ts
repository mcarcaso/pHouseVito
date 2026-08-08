import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ObjectContext } from "../../src/context/ObjectContext.js";
import { StorePermissionDeniedError } from "../../src/stores/Store.js";
import { FileSkillStore } from "../../src/stores/skills/FileSkillStore.js";

function writeSkill(
  root: string,
  directory: string,
  args: { name?: string; description: string; content?: string }
): void {
  const skillDir = join(root, directory);
  mkdirSync(skillDir, { recursive: true });
  const nameLine = args.name ? `name: ${args.name}\n` : "";
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\n${nameLine}description: ${args.description}\n---\n${args.content ?? ""}`
  );
}

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "vito-skill-store-"));
  const builtinSkillsDir = join(root, "builtin");
  const skillsDir = join(root, "user");
  mkdirSync(builtinSkillsDir, { recursive: true });
  mkdirSync(skillsDir, { recursive: true });
  const x = new ObjectContext({
    builtinSkillsDir: () => builtinSkillsDir,
    skillsDir: () => skillsDir,
  });
  return { root, builtinSkillsDir, skillsDir, x, store: new FileSkillStore() };
}

describe("FileSkillStore", () => {
  it("merges built-in and user skills with user overrides", () => {
    const { root, builtinSkillsDir, skillsDir, x, store } = createHarness();
    try {
      writeSkill(builtinSkillsDir, "shared", {
        name: "shared",
        description: "Built-in version",
      });
      writeSkill(builtinSkillsDir, "builtin-only", {
        description: "Built-in only",
      });
      writeSkill(skillsDir, "shared", {
        name: "shared",
        description: "User version",
      });

      const skills = store.list(x, {});
      assert.equal(skills.length, 2);
      assert.equal(skills.find((skill) => skill.name === "shared")?.source, "user");
      assert.equal(
        skills.find((skill) => skill.name === "shared")?.description,
        "User version"
      );
      assert.equal(store.count(x, { sources: ["builtin"] }), 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("optionally includes recursively discovered files", () => {
    const { root, skillsDir, x, store } = createHarness();
    try {
      writeSkill(skillsDir, "files", {
        name: "files",
        description: "Has files",
      });
      mkdirSync(join(skillsDir, "files", "scripts"));
      writeFileSync(join(skillsDir, "files", "scripts", "run.ts"), "export {};\n");

      const withoutFiles = store.list(x, { names: ["files"] })[0];
      const withFiles = store.list(x, {
        names: ["files"],
        includeFiles: true,
      })[0];
      assert.equal(withoutFiles?.files, undefined);
      assert.deepEqual(withFiles?.files?.map((file) => file.name), [
        "scripts/run.ts",
        "SKILL.md",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates, updates, and deletes user skills", () => {
    const { root, x, store } = createHarness();
    try {
      const created = store.create(x, {
        name: "created",
        description: "Initial",
        content: "# Instructions\n",
      });
      assert.equal(created.source, "user");
      const updated = store.update(x, {
        name: "created",
        changes: { description: "Updated" },
      });
      assert.equal(updated.description, "Updated");
      assert.equal(store.delete(x, { names: ["created"] }), 1);
      assert.equal(store.count(x, {}), 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects mutations of built-in skills", () => {
    const { root, builtinSkillsDir, x, store } = createHarness();
    try {
      writeSkill(builtinSkillsDir, "protected", {
        name: "protected",
        description: "Read only",
      });
      assert.throws(
        () => store.update(x, {
          name: "protected",
          changes: { description: "Nope" },
        }),
        StorePermissionDeniedError
      );
      assert.throws(
        () => store.delete(x, { names: ["protected"] }),
        StorePermissionDeniedError
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
