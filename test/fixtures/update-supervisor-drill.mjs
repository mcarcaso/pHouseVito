import { mkdtemp, mkdir, writeFile, readFile, symlink, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const worker = fileURLToPath(new URL("../../dist/cli/update-apply.js", import.meta.url));
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const parent = await realpath(await mkdtemp("/tmp/vud-"));
for (const mode of [
  "success",
  "rollback",
  "migration",
  "dashboard-success",
  "dashboard-rollback",
]) {
  const fail = mode.endsWith("rollback");
  const dashboard = mode.startsWith("dashboard-");
  const migration = mode === "migration";
  const root = join(parent, mode);
  const env = { ...process.env, PM2_HOME: join(root, "pm2"), VITO_RELEASE_MODE: "1" };
  const command = (file, args) =>
    exec(file, args, { env, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  await mkdir(join(root, "releases"), { recursive: true });
  await mkdir(join(root, "data/user"), { recursive: true });
  await mkdir(join(root, "data/update-lock"));
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  const prior = join(root, "releases/vito-baseline");
  await mkdir(prior);
  await symlink(
    fileURLToPath(new URL("../../node_modules", import.meta.url)),
    join(prior, "node_modules"),
  );
  const db = migration ? new Database(join(root, "data/user/vito.db")) : null;
  if (db) {
    db.pragma("journal_mode=WAL");
    db.pragma("wal_autocheckpoint=0");
    db.exec("CREATE TABLE evidence(value TEXT); INSERT INTO evidence VALUES('fake-wal-data');");
  }
  const baseline = "a".repeat(40),
    next = "b".repeat(40);
  await writeFile(join(root, "data/user/marker.txt"), "preserve me");
  await writeFile(join(prior, "RELEASE_INFO"), `Revision: ${baseline}\nDirty: 0\n`);
  const app = `import http from 'node:http';import fs from 'node:fs';import {launchUpdateSupervisor} from ${JSON.stringify(worker)};const revision=/Revision: ([a-f0-9]+)/.exec(fs.readFileSync('RELEASE_INFO','utf8'))[1];http.createServer(async (req,res)=>{if(req.url==='/apply'){const fd=fs.openSync(${JSON.stringify(join(root, "supervisor.log"))},'a');try{await launchUpdateSupervisor([${JSON.stringify(join(root, "supervisor.mjs"))}],process.cwd(),fd);}finally{fs.closeSync(fd);}res.end('queued');return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'ok',revision}));}).listen(${port},'127.0.0.1');`;
  await writeFile(join(prior, "server.mjs"), app);
  await writeFile(join(prior, "run.sh"), "#!/bin/bash\nexec node server.mjs\n", { mode: 0o700 });
  await symlink(prior, join(root, "current"));
  await writeFile(
    join(root, "run-current.sh"),
    `#!/bin/bash\nset -e\ncd "$(realpath '${root}/current')"\nexec ./run.sh\n`,
    { mode: 0o700 },
  );
  await writeFile(
    join(root, "update-service.json"),
    JSON.stringify({
      schema: 1,
      service: "vito-server",
      healthUrl: `http://127.0.0.1:${port}/api/health`,
    }),
  );
  await writeFile(join(root, "data/update-status.json"), '{"state":"queued"}');
  const stage = join(root, "stage");
  await mkdir(stage);
  const filename = `vito-installer-vtest-${process.platform}-${process.arch}`;
  const content = `#!/usr/bin/env node\nconst fs=require('node:fs');const p=require('node:path');const [action,root]=process.argv.slice(2);if(action==='install'){const target=p.join(root,'releases/vito-new');fs.mkdirSync(target);fs.writeFileSync(p.join(target,'RELEASE_INFO'),'Revision: ${next}\\nDirty: 0\\n');fs.copyFileSync(p.join(root,'releases/vito-baseline/server.mjs'),p.join(target,'server.mjs'));fs.writeFileSync(p.join(target,'run.sh'),${JSON.stringify(fail ? "#!/bin/bash\nexit 1\n" : "#!/bin/bash\nexec node server.mjs\n")},{mode:0o700});}\n`;
  const bytes = Buffer.from(content);
  await writeFile(join(stage, filename), bytes, { mode: 0o700 });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const key = publicKey.export({ type: "spki", format: "pem" }).toString();
  const raw = Buffer.from(
    JSON.stringify({
      schema: 2,
      version: "vtest",
      revision: next,
      sequence: 1,
      dataImpact: migration
        ? {
            kind: "compatible-migration",
            files: ["vito.db"],
            notes: "Fixture migration with WAL snapshot",
            backwardCompatible: true,
          }
        : { kind: "none" },
      assets: [
        {
          platform: `${process.platform}-${process.arch}`,
          nodeMajor: Number(process.versions.node.split(".")[0]),
          file: filename,
          url: `https://github.com/mcarcaso/pHouseVito/releases/download/vtest/${filename}`,
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ],
    }),
  );
  await writeFile(join(stage, "update-manifest.json"), raw);
  await writeFile(
    join(stage, "update-manifest.sig"),
    sign(null, raw, privateKey).toString("base64"),
  );
  try {
    await command("pm2", [
      "start",
      join(root, "run-current.sh"),
      "--name",
      "vito-server",
      "--interpreter",
      "bash",
      "--cwd",
      root,
    ]);
    for (let n = 0; n < 30; n++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    const child = `import {runApplyWorker} from ${JSON.stringify(worker)};try {await runApplyWorker(${JSON.stringify(root)},${JSON.stringify(stage)},${JSON.stringify(next)},{publicKey:${JSON.stringify(key)},healthAttempts:2});}catch(e){if(!${fail})throw e;console.log('Expected unhealthy-new-release failure:',e.message);}`;
    if (dashboard) {
      await writeFile(
        join(root, "supervisor.mjs"),
        "await new Promise(r=>setTimeout(r,500));" + child,
      );
      const response = await fetch(`http://127.0.0.1:${port}/apply`, { method: "POST" });
      assert.equal(response.status, 200);
      for (let n = 0; n < 200; n++) {
        const status = JSON.parse(await readFile(join(root, "data/update-status.json"), "utf8"));
        if (
          ["succeeded", "rolled-back", "failed-before-activation", "recovery-required"].includes(
            status.state,
          )
        )
          break;
        await new Promise((r) => setTimeout(r, 200));
      }
    } else {
      const result = await exec(process.execPath, ["--input-type=module", "-e", child], {
        env,
        timeout: 60000,
        maxBuffer: 4 * 1024 * 1024,
      });
      console.log(result.stdout.trim());
    }
    const state = JSON.parse(await readFile(join(root, "data/update-status.json"), "utf8"));
    assert.equal(state.state, fail ? "rolled-back" : "succeeded");
    assert.equal(
      await realpath(join(root, "current")),
      fail ? prior : join(root, "releases/vito-new"),
    );
    assert.equal(await readFile(join(root, "data/user/marker.txt"), "utf8"), "preserve me");
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.equal(health.revision, fail ? baseline : next);
    if (migration) {
      const backup = new Database(join(state.backup, "vito.db"), { readonly: true });
      assert.equal(backup.prepare("SELECT value FROM evidence").get().value, "fake-wal-data");
      backup.close();
    }
    console.log(
      `${mode.toUpperCase()}: actual isolated PM2 stop/start, revision-specific health, preserved fake data, state=${state.state}`,
    );
  } finally {
    await command("pm2", ["kill"]).catch(() => {});
    db?.close();
  }
}
await rm(parent, { recursive: true, force: true });
