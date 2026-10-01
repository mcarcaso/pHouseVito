import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
if (!process.argv[2] || !process.argv[3])
  throw new Error(
    "Usage: node test/fixtures/update-dashboard-browser.mjs STAGED_WEB_DIR SCREENSHOT_DIR (never use live assets)",
  );
const stage = resolve(process.argv[2]);
const out = resolve(process.argv[3]);
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    const file = join(stage, path.includes(".") ? path : "index.html");
    const b = await readFile(file);
    res.setHeader(
      "Content-Type",
      extname(file) === ".js"
        ? "application/javascript"
        : extname(file) === ".html"
          ? "text/html"
          : "application/octet-stream",
    );
    res.end(b);
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const log = [],
  assertions = [];
try {
  for (const [width, appearance] of [
    [1440, "light"],
    [1920, "dark"],
    [390, "light"],
    [320, "light"],
    [320, "dark"],
  ]) {
    let operation = null,
      failures = 0,
      kind = "compatible-migration",
      supported = true,
      stageError = false;
    const applies = [];
    const plan = () => ({
      version: "v2026.10.02",
      revision: "b".repeat(40),
      dataImpact: {
        kind,
        files: ["vito.db", "vito.config.json"],
        notes: "Backward-compatible schema update.",
      },
    });
    const context = await browser.newContext({
      viewport: { width, height: 950 },
      colorScheme: appearance,
    });
    await context.addInitScript((a) => {
      localStorage.setItem("vito-appearance", a);
      localStorage.setItem("vito-color-palette", "ledger");
    }, appearance);
    await context.routeWebSocket("**/*", (ws) => ws.close());
    await context.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== origin) {
        log.push("BLOCKED external " + u.origin);
        return route.abort();
      }
      if (!u.pathname.startsWith("/api/")) return route.continue();
      let data = {};
      if (u.pathname === "/api/auth/check") data = { authenticated: true, passwordSet: true };
      else if (u.pathname === "/api/server/status")
        data = {
          managedRelease: supported,
          uptime: 7200,
          pid: 12345,
          memoryUsage: { rss: 123456789, heapUsed: 23456789, heapTotal: 34567890 },
          system: { cpuUsage: 2, memoryTotal: 4294967296, memoryUsed: 1073741824 },
          nodeVersion: "v24.13.0",
        };
      else if (u.pathname === "/api/server/update/status") {
        if (failures > 0) {
          failures--;
          return route.abort();
        }
        data = {
          supported,
          reason: supported ? undefined : "Source checkout: signed binary apply is unavailable.",
          operation,
        };
      } else if (u.pathname === "/api/server/update/check")
        data = {
          output: JSON.stringify({ ...plan(), version: "v2026.10.01", revision: "a".repeat(40) }),
        };
      else if (u.pathname === "/api/server/update/stage") {
        if (stageError)
          return route.fulfill({ status: 500, json: { error: "Download checksum mismatch" } });
        data = { output: "Verified and staged: /fake/staging/installer", stagedPlan: plan() };
      } else if (u.pathname === "/api/server/update/apply") {
        applies.push(route.request().postDataJSON());
        operation = { state: "starting", version: plan().version };
        failures = 1;
        data = { queued: true };
      } else if (u.pathname === "/api/config")
        data = { bot: { name: "QA Vito" }, settings: {}, channels: {}, cron: { jobs: [] } };
      else if (/sessions|providers|jobs/.test(u.pathname)) data = [];
      await route.fulfill({ json: data });
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => log.push("ERROR " + e.message));
    await page.goto(origin + "/operation/server");
    await page.getByRole("button", { name: "Check for update", exact: true }).waitFor();
    assert.equal(await page.getByText("Rebuild & restart", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Check for update", exact: true }).click();
    await page.getByRole("button", { name: "Download and verify", exact: true }).click();
    await page.getByRole("button", { name: "Update Vito…", exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.screenshot({ path: join(out, `${width}-${appearance}.png`), fullPage: true });
    if (width === 1920)
      await page.screenshot({ path: join(out, "1920-dark-viewport.png"), fullPage: false });
    assertions.push(
      `${width}/${appearance}: staged migration visible; no horizontal overflow; no managed rebuild control`,
    );
    if (width === 1440) {
      page.once("dialog", async (d) => {
        assert.ok(d.message().includes("v2026.10.02"));
        assert.ok(d.message().includes("b".repeat(40)));
        assert.ok(d.message().includes("vito.db, vito.config.json"));
        await d.dismiss();
      });
      await page.getByRole("button", { name: "Update Vito…", exact: true }).click();
      assert.equal(applies.length, 0);
      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: "Update Vito…", exact: true }).click();
      await page
        .getByText("Update queued. Vito may briefly disconnect while it restarts.", { exact: true })
        .waitFor();
      assert.deepEqual(applies[0], {
        version: "v2026.10.02",
        revision: "b".repeat(40),
        approved: true,
        approveMigration: true,
      });
      assert.equal(
        await page.getByRole("button", { name: "Check for update", exact: true }).isDisabled(),
        true,
      );
      await page
        .getByText("Connection interrupted. Retrying update status automatically…", { exact: true })
        .waitFor({ timeout: 12000 });
      operation = { state: "succeeded", version: "v2026.10.02" };
      await page
        .getByText("Update completed · v2026.10.02", { exact: true })
        .waitFor({ timeout: 12000 });
      assert.equal(
        await page.getByRole("button", { name: "Check for update", exact: true }).isDisabled(),
        false,
      );
      assert.equal(
        await page
          .getByText("Update queued. Vito may briefly disconnect while it restarts.", {
            exact: true,
          })
          .count(),
        0,
      );
      assertions.push(
        "cancel sends no apply; confirm uses actually staged revision/policy; duplicate disabled; reconnect polling recovers",
      );
      operation = null;
      kind = "breaking";
      await page.getByRole("button", { name: "Check for update", exact: true }).click();
      await page
        .getByText("Operator-led recovery plan required; self-service apply is unavailable.", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Update Vito…", exact: true }).count(),
        0,
      );
      kind = "none";
      await page.getByRole("button", { name: "Check for update", exact: true }).click();
      stageError = true;
      await page.getByRole("button", { name: "Download and verify", exact: true }).click();
      await page.getByText("Download checksum mismatch", { exact: true }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Update Vito…", exact: true }).count(),
        0,
      );
      stageError = false;
      await page.getByRole("button", { name: "Download and verify", exact: true }).click();
      page.once("dialog", async (d) => {
        assert.ok(d.message().includes("No new full backup will be taken"));
        await d.dismiss();
      });
      await page.getByRole("button", { name: "Update Vito…", exact: true }).click();
      assert.equal(applies.length, 1);
      assertions.push(
        "no-data confirmation explains no fresh full backup; cancel still sends no apply",
      );
      operation = { state: "recovery-required", version: "fixture" };
      await page
        .getByText("Operator recovery required · fixture", { exact: true })
        .waitFor({ timeout: 10000 });
      assert.equal(
        await page.getByRole("button", { name: "Check for update", exact: true }).isDisabled(),
        true,
      );
      supported = false;
      await page.reload();
      await page
        .getByText("Source checkout: signed binary apply is unavailable.", { exact: true })
        .waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Check for update", exact: true }).count(),
        0,
      );
      assert.equal(await page.getByText("Rebuild & restart", { exact: true }).count(), 1);
      assertions.push(
        "breaking policy blocked; checksum failure not staged; recovery lock disables controls; unsupported source install preserves rebuild control",
      );
    }
    await context.close();
  }
  assert.equal(log.filter((x) => x.startsWith("ERROR ")).length, 0, log.join("\n"));
  console.log(assertions.join("\n"));
} finally {
  await browser.close();
  server.close();
  await writeFile(join(out, "results.json"), JSON.stringify({ assertions, log }, null, 2));
}
