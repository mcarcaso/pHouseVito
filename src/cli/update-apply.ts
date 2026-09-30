import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { verifyAsset, verifyUpdateManifest } from "./update-manifest.js";

const exec = promisify(execFile);
const serviceSchema = z
  .object({
    schema: z.literal(1),
    service: z.literal("vito-server"),
    healthUrl: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "http:" &&
          url.hostname === "127.0.0.1" &&
          url.pathname === "/api/health" &&
          !url.username &&
          !url.password
        );
      }),
  })
  .strict();

export async function managedRoot(projectRoot: string): Promise<string> {
  const release = await realpath(projectRoot);
  const root = dirname(dirname(release));
  if (
    dirname(release) !== join(root, "releases") ||
    !/^vito-[A-Za-z0-9._-]+$/.test(release.split("/").pop() ?? "")
  )
    throw new Error(
      "Self-service updates require a managed binary installation, not a source checkout",
    );
  if (
    (await realpath(join(root, "current"))) !== release ||
    (await realpath(join(release, "user"))) !== (await realpath(join(root, "data/user")))
  )
    throw new Error("Release is not the active managed installation");
  return root;
}

export async function updateStatus(projectRoot: string): Promise<Record<string, unknown>> {
  try {
    const root = await managedRoot(projectRoot);
    const service = serviceSchema.parse(
      JSON.parse(await readFile(join(root, "update-service.json"), "utf8")),
    );
    await access(join(root, "releases"), constants.W_OK);
    await access(root, constants.W_OK);
    const operation = await readFile(join(root, "data/update-status.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    return { supported: true, service: service.service, operation };
  } catch (error) {
    return { supported: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function requestApply(
  projectRoot: string,
  stage: string,
  expectedRevision: string,
  approveMigration: boolean,
): Promise<void> {
  const root = await managedRoot(projectRoot);
  if (!(await updateStatus(projectRoot)).supported)
    throw new Error("Update supervisor is not provisioned or installation is not writable");
  // Verify the immutable signed plan before launching; worker verifies it again.
  const plan = await loadPlan(stage);
  if (plan.manifest.revision !== expectedRevision)
    throw new Error("Release changed; review the update again");
  if (plan.manifest.schema !== 2)
    throw new Error("Legacy manifest lacks signed backup classification");
  if (plan.manifest.dataImpact.kind === "breaking")
    throw new Error(
      "Breaking-data updates require an operator recovery plan; self-service apply is disabled",
    );
  if (plan.manifest.dataImpact.kind === "compatible-migration" && !approveMigration)
    throw new Error("Explicit approval of the migration and targeted backup is required");
  // A crash leaves this lock in place deliberately. Never guess that another updater is dead.
  await mkdir(join(root, "data/update-lock"), { mode: 0o700 });
  try {
    await writeFile(
      join(root, "data/update-status.json"),
      JSON.stringify({
        state: "queued",
        revision: expectedRevision,
        startedAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    const log = await import("node:fs");
    const fd = log.openSync(join(root, "data/update.log"), "a", 0o600);
    try {
      const child = spawn(
        process.execPath,
        [join(projectRoot, "dist/cli/update-worker.js"), root, resolve(stage), expectedRevision],
        {
          detached: true,
          stdio: ["ignore", fd, fd],
          cwd: projectRoot,
        },
      );
      await new Promise<void>((done, fail) => {
        child.once("spawn", done);
        child.once("error", fail);
      });
      child.unref();
    } finally {
      log.closeSync(fd);
    }
  } catch (error) {
    await rm(join(root, "data/update-lock"), { recursive: true, force: true });
    throw error;
  }
}

async function loadPlan(stage: string, publicKey?: string) {
  const raw = await readFile(join(stage, "update-manifest.json"));
  const signature = (await readFile(join(stage, "update-manifest.sig"), "utf8")).trim();
  const manifest = verifyUpdateManifest(raw, signature, publicKey);
  const asset = manifest.assets.find((a) => a.platform === `${process.platform}-${process.arch}`);
  if (!asset || asset.nodeMajor !== Number(process.versions.node.split(".")[0]))
    throw new Error("Incompatible signed installer");
  const installer = join(stage, asset.file);
  verifyAsset(await readFile(installer), asset.sha256, asset.size);
  return { manifest, installer };
}

export interface ApplyHooks {
  install(): Promise<void>;
  stop(): Promise<void>;
  backup(): Promise<void>;
  activate(): Promise<void>;
  start(): Promise<void>;
  healthy(): Promise<boolean>;
  rollback(): Promise<void>;
  record(state: string): Promise<void>;
}

/** Cutover ordering is shared with fault-injection tests. Compatible migrations never restore live data on rollback. */
export async function applyWithRollback(hooks: ApplyHooks): Promise<void> {
  let stopped = false;
  let switched = false;
  try {
    await hooks.record("installing");
    await hooks.install();
    await hooks.record("stopping");
    stopped = true;
    await hooks.stop();
    await hooks.record("backing-up");
    await hooks.backup();
    switched = true;
    await hooks.activate();
    await hooks.record("starting");
    await hooks.start();
    if (!(await hooks.healthy())) throw new Error("New release failed health checks");
    await hooks.record("succeeded");
  } catch (error) {
    if (stopped) {
      try {
        if (switched) {
          await hooks.stop();
          await hooks.rollback();
        }
        await hooks.start();
        if (!(await hooks.healthy())) throw new Error("Previous release failed health checks");
        await hooks.record(switched ? "rolled-back" : "failed-before-activation");
      } catch (rollbackError) {
        await hooks.record("recovery-required");
        throw new AggregateError(
          [error, rollbackError],
          "Update and recovery failed; operator intervention required",
        );
      }
    } else await hooks.record("failed-before-activation");
    throw error;
  }
}

export async function runApplyWorker(
  root: string,
  stage: string,
  expectedRevision: string,
  options: { publicKey?: string; healthAttempts?: number } = {},
): Promise<void> {
  root = await realpath(root);
  const plan = await loadPlan(stage, options.publicKey);
  const { manifest, installer } = plan;
  if (
    manifest.schema !== 2 ||
    manifest.revision !== expectedRevision ||
    manifest.dataImpact.kind === "breaking"
  )
    throw new Error("Unsupported signed update plan");
  const service = serviceSchema.parse(
    JSON.parse(await readFile(join(root, "update-service.json"), "utf8")),
  );
  const prior = await realpath(join(root, "current"));
  if (dirname(prior) !== join(root, "releases")) throw new Error("Unsafe current link");
  const installedInfo = await readFile(join(prior, "RELEASE_INFO"), "utf8");
  const installedSequence = await readFile(join(root, "data/update-sequence"), "utf8")
    .then(Number)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return 0;
      throw error;
    });
  if (!Number.isSafeInteger(installedSequence) || installedSequence < 0)
    throw new Error("Invalid update sequence receipt; operator review required");
  if (
    manifest.sequence <= installedSequence ||
    installedInfo.includes(`Revision: ${manifest.revision}`)
  )
    throw new Error("Release is already installed or replayed");
  const processInfo = JSON.parse(
    (await exec("pm2", ["jlist"], { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 })).stdout,
  ) as Array<{ name: string; pm2_env: { pm_cwd: string; pm_exec_path: string } }>;
  const processEntry = processInfo.find((entry) => entry.name === service.service);
  // The stable launcher must resolve current on every start; reject PM2's pinned old-release paths.
  if (
    !processEntry ||
    (await realpath(processEntry.pm2_env.pm_exec_path)) !== join(root, "run-current.sh")
  )
    throw new Error("PM2 must use the provisioned stable run-current.sh launcher");
  const backupDir = join(root, "data/update-backups", `${manifest.sequence}-${manifest.version}`);
  const record = async (state: string) => {
    const temporary = join(root, "data/.update-status-next");
    await writeFile(
      temporary,
      JSON.stringify({
        state,
        version: manifest.version,
        revision: manifest.revision,
        dataImpact: manifest.dataImpact,
        backup: manifest.dataImpact.kind === "none" ? null : backupDir,
        updatedAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    await rename(temporary, join(root, "data/update-status.json"));
  };
  const command = async (file: string, args: string[]) => {
    await exec(file, args, { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
  };
  const switchTo = async (target: string) => {
    const next = join(root, ".update-current-next");
    await rm(next, { force: true });
    await (await import("node:fs/promises")).symlink(target, next);
    await rename(next, join(root, "current"));
  };
  let installedTarget = "";
  let expectedHealthRevision = manifest.revision;
  try {
    await applyWithRollback({
      record,
      install: async () => {
        // An earlier attempt may already have installed the exact signed release.
        const { readdir: list, readFile: read } = await import("node:fs/promises");
        let existing = false;
        for (const entry of await list(join(root, "releases"), { withFileTypes: true })) {
          if (!entry.isDirectory() || !/^vito-[A-Za-z0-9._-]+$/.test(entry.name)) continue;
          const info = await read(join(root, "releases", entry.name, "RELEASE_INFO"), "utf8").catch(
            () => "",
          );
          if (info.includes(`Revision: ${manifest.revision}\n`) && /^Dirty: 0$/m.test(info))
            existing = true;
        }
        if (!existing) await command(installer, ["install", root]);
        // Installer archive version is not assumed to equal the feed tag. Locate by exact revision.
        const { readdir } = await import("node:fs/promises");
        const candidates = [];
        for (const entry of await readdir(join(root, "releases"), { withFileTypes: true })) {
          if (!entry.isDirectory() || !/^vito-[A-Za-z0-9._-]+$/.test(entry.name)) continue;
          const target = join(root, "releases", entry.name);
          const info = await readFile(join(target, "RELEASE_INFO"), "utf8").catch(() => "");
          if (info.includes(`Revision: ${manifest.revision}\n`) && /^Dirty: 0$/m.test(info))
            candidates.push(target);
        }
        if (candidates.length !== 1)
          throw new Error("Cannot identify a unique clean installed signed revision");
        installedTarget = candidates[0];
        await command(installer, ["verify", root, installedTarget.split("/vito-").pop()!]);
      },
      stop: async () => {
        await command("pm2", ["stop", service.service]);
      },
      backup: async () => {
        if (manifest.dataImpact.kind !== "compatible-migration") return;
        await mkdir(backupDir, { recursive: true, mode: 0o700 });
        for (const file of manifest.dataImpact.files) {
          const source = join(root, "data/user", file);
          try {
            await access(source);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
            throw error;
          }
          if ((await realpath(source)) !== source)
            throw new Error("Backup target must not be a symlink");
          if (file.endsWith(".db")) {
            const { createRequire } = await import("node:module");
            const Database = createRequire(join(prior, "package.json"))("better-sqlite3");
            const db = new Database(source, { readonly: true });
            try {
              await db.backup(join(backupDir, file));
              const snapshot = new Database(join(backupDir, file), { readonly: true });
              try {
                if (snapshot.pragma("quick_check", { simple: true }) !== "ok")
                  throw new Error("Backup integrity check failed");
              } finally {
                snapshot.close();
              }
            } finally {
              db.close();
            }
          } else await copyFile(source, join(backupDir, file));
          await (await import("node:fs/promises")).chmod(join(backupDir, file), 0o600);
        }
      },
      activate: async () => {
        await switchTo(installedTarget);
      },
      start: async () => {
        if ((await realpath(join(root, "current"))) === prior)
          expectedHealthRevision = /^Revision: ([a-f0-9]{40})$/m.exec(installedInfo)?.[1] ?? "";
        await command("pm2", ["start", service.service]);
      },
      healthy: async () => {
        for (let attempt = 0; attempt < (options.healthAttempts ?? 60); attempt++) {
          try {
            const response = await fetch(service.healthUrl, {
              signal: AbortSignal.timeout(1500),
              redirect: "error",
            });
            if (response.ok && (await matchesHealth(response, expectedHealthRevision))) {
              await new Promise((done) => setTimeout(done, 1000));
              const check = await fetch(service.healthUrl, {
                signal: AbortSignal.timeout(1500),
                redirect: "error",
              });
              if (check.ok && (await matchesHealth(check, expectedHealthRevision))) return true;
            }
          } catch {
            /* wait for startup */
          }
          await new Promise((done) => setTimeout(done, 1000));
        }
        return false;
      },
      rollback: async () => {
        expectedHealthRevision = /^Revision: ([a-f0-9]{40})$/m.exec(installedInfo)?.[1] ?? "";
        await switchTo(prior);
      },
    });
    await writeFile(join(root, "data/.update-sequence-next"), String(manifest.sequence), {
      mode: 0o600,
    });
    await rename(join(root, "data/.update-sequence-next"), join(root, "data/update-sequence"));
  } finally {
    // Recovery-required retains the lock so another update cannot obscure the failure.
    const status = JSON.parse(await readFile(join(root, "data/update-status.json"), "utf8"));
    if (status.state !== "recovery-required")
      await rm(join(root, "data/update-lock"), { recursive: true, force: true });
  }
}

async function matchesHealth(response: Response, revision: string): Promise<boolean> {
  const data = (await response.json()) as { status?: string; revision?: string };
  return data.status === "ok" && data.revision === revision;
}
