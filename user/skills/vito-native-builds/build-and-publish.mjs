#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const mobileDir = join(root, "mobile");
const appJsonPath = join(mobileDir, "app.json");
const configPath = join(root, "user", "vito.config.json");
const buildsRoot = join(root, "user", "drive", "builds");
const canonicalDir = join(buildsRoot, "vito");
const targetArg = process.argv[2] ?? "all";
const profiles = targetArg === "all" ? ["development", "preview"] : [targetArg];

if (!existsSync(appJsonPath) || !existsSync(configPath)) {
  throw new Error("Run this command from the Vito repository root");
}
if (profiles.some((profile) => !["development", "preview"].includes(profile))) {
  throw new Error("Usage: build-and-publish.mjs development|preview|all");
}

function run(command, args, options = {}) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

function commandOutput(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
}

function writeAtomic(path, content) {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeHtml(value) {
  return escapeXml(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function nextBuildNumber() {
  const app = readJson(appJsonPath);
  const current = Number.parseInt(String(app.expo?.ios?.buildNumber ?? "0"), 10);
  if (!Number.isSafeInteger(current) || current < 0) throw new Error("Invalid iOS build number");
  const next = current + 1;
  app.expo.ios.buildNumber = String(next);
  writeAtomic(appJsonPath, `${JSON.stringify(app, null, 2)}\n`);
  return { app, buildNumber: String(next) };
}

function verifyToolchain() {
  const developerDir = commandOutput("xcode-select", ["-p"]);
  if (!developerDir.includes("Xcode")) throw new Error(`Full Xcode is not selected: ${developerDir}`);
  console.log(commandOutput("xcodebuild", ["-version"]));
  console.log(`CocoaPods ${commandOutput("pod", ["--version"])}`);
  run("npm", ["run", "typecheck"], { cwd: mobileDir });
}

function extractIpaMetadata(ipaPath) {
  const entries = commandOutput("unzip", ["-Z1", ipaPath]).split("\n");
  const infoEntry = entries.find((entry) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(entry));
  const profileEntry = entries.find((entry) => /^Payload\/[^/]+\.app\/embedded\.mobileprovision$/.test(entry));
  if (!infoEntry) throw new Error("IPA has no application Info.plist");
  if (!profileEntry) throw new Error("IPA has no embedded provisioning profile");

  const temporaryDir = mkdtempSync(join(tmpdir(), "vito-ipa-"));
  try {
    const infoPath = join(temporaryDir, "Info.plist");
    const profilePath = join(temporaryDir, "embedded.mobileprovision");
    const decodedProfilePath = join(temporaryDir, "profile.plist");
    writeFileSync(infoPath, execFileSync("unzip", ["-p", ipaPath, infoEntry]));
    writeFileSync(profilePath, execFileSync("unzip", ["-p", ipaPath, profileEntry]));
    writeFileSync(decodedProfilePath, execFileSync("security", ["cms", "-D", "-i", profilePath]));

    const plistValue = (key) => commandOutput("plutil", ["-extract", key, "raw", "-o", "-", infoPath]);
    const profileText = readFileSync(decodedProfilePath, "utf8");
    if (!profileText.includes("<key>ProvisionedDevices</key>")) {
      throw new Error("Provisioning profile is not an ad hoc/development device profile");
    }
    return {
      bundleIdentifier: plistValue("CFBundleIdentifier"),
      version: plistValue("CFBundleShortVersionString"),
      buildNumber: plistValue("CFBundleVersion"),
    };
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true });
  }
}

function installerHtml({ profile, version, buildNumber }) {
  const profileLabel = profile === "development" ? "Development" : "Preview";
  const description =
    profile === "development"
      ? "This development client connects to Metro for immediate code updates while we work."
      : "This preview build runs its embedded bundle and does not depend on Metro.";
  const manifestUrl = `${baseUrl}/d/builds/vito-${profile}/manifest.plist?build=${buildNumber}`;
  const installUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="theme-color" content="#1b2746" />
  <title>Install Vito ${profileLabel}</title>
  <style>
    :root{color-scheme:dark;--bg:#10172a;--panel:#1b2746;--line:#34415f;--text:#f4f0e8;--muted:#aeb6c9;--accent:#ff811d;--accentText:#172039}
    *{box-sizing:border-box}body{margin:0;min-height:100svh;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;display:grid;place-items:center;padding:24px}main{width:min(100%,420px)}
    .brand{display:flex;align-items:center;gap:16px;margin-bottom:28px}.icon{width:72px;height:72px;border-radius:17px;box-shadow:0 8px 28px #0008}.eyebrow{color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;margin:0 0 6px}.title{font-size:28px;line-height:1.05;letter-spacing:-.03em;margin:0}.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:22px}.version{display:flex;justify-content:space-between;gap:16px;padding-bottom:18px;margin-bottom:20px;border-bottom:1px solid var(--line);font-size:13px}.label{color:var(--muted)}.value{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.install{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;border-radius:13px;background:var(--accent);color:var(--accentText);font-weight:850;text-decoration:none;font-size:16px}.install:active{transform:scale(.985);filter:brightness(.92)}.note{color:var(--muted);font-size:13px;line-height:1.5;margin:18px 2px 0}.foot{color:#7f899f;font-size:11px;text-align:center;margin-top:22px}
    @media(prefers-color-scheme:light){:root{--bg:#f4f0e8;--panel:#fff;--line:#d8d4cc;--text:#1b2746;--muted:#687085;--accent:#e86d0b;--accentText:#fff}.icon{box-shadow:0 8px 24px #1b274622}.foot{color:#7a8190}}
  </style>
</head>
<body><main>
  <div class="brand"><img class="icon" src="icon.png" alt="Vito app icon" /><div><p class="eyebrow">${escapeHtml(profileLabel)} build</p><h1 class="title">Install Vito</h1></div></div>
  <section class="card"><div class="version"><span class="label">Version</span><span class="value">${escapeHtml(version)} (${escapeHtml(buildNumber)})</span></div><a class="install" href="${escapeHtml(installUrl)}">Install ${profileLabel.toLowerCase()} build</a><p class="note">Open this page in Safari on the registered iPhone. ${escapeHtml(description)}</p></section>
  <p class="foot">Locally compiled · Signed for pHouse Productions</p>
</main></body></html>\n`;
}

function manifestPlist({ profile, buildNumber, bundleIdentifier }) {
  const title = profile === "development" ? "Vito Development" : "Vito Preview";
  const ipaUrl = `${baseUrl}/d/builds/vito-${profile}/vito-${profile}.ipa?build=${buildNumber}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>items</key><array><dict><key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>${escapeXml(ipaUrl)}</string></dict></array><key>metadata</key><dict><key>bundle-identifier</key><string>${escapeXml(bundleIdentifier)}</string><key>bundle-version</key><string>${escapeXml(buildNumber)}</string><key>kind</key><string>software</string><key>title</key><string>${escapeXml(title)}</string></dict></dict></array></dict></plist>\n`;
}

function loadBuildMetadata() {
  const path = join(canonicalDir, "builds.json");
  if (!existsSync(path)) return {};
  try { return readJson(path); } catch { return {}; }
}

function selectorHtml(metadata) {
  const order = ["development", "preview"];
  const cards = order
    .filter((profile) => metadata[profile])
    .map((profile) => {
      const item = metadata[profile];
      const name = profile === "development" ? "Development" : "Preview";
      const description = profile === "development" ? "Connects to Metro for immediate code updates while we work." : "Runs its embedded bundle without depending on Metro.";
      const manifestUrl = `${baseUrl}/d/builds/vito-${profile}/manifest.plist?build=${item.buildNumber}`;
      const installUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
      return `<article class="build"><div class="buildHead"><span class="buildName">${name}</span><span class="version">${escapeHtml(item.version)} (${escapeHtml(item.buildNumber)})</span></div><p class="description">${description}</p><a class="install${profile === "preview" ? " secondary" : ""}" href="${escapeHtml(installUrl)}">Install ${profile} build</a></article>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" /><meta name="theme-color" content="#1b2746" /><title>Install Vito</title><style>
:root{color-scheme:dark;--bg:#10172a;--panel:#1b2746;--line:#34415f;--text:#f4f0e8;--muted:#aeb6c9;--accent:#ff811d;--accentText:#172039}*{box-sizing:border-box}body{margin:0;min-height:100svh;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;display:grid;place-items:center;padding:24px}main{width:min(100%,460px)}.brand{display:flex;align-items:center;gap:16px;margin-bottom:30px}.icon{width:72px;height:72px;border-radius:17px;box-shadow:0 8px 28px #0008}.eyebrow{color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;margin:0 0 6px}.title{font-size:30px;line-height:1.05;letter-spacing:-.035em;margin:0}.intro{color:var(--muted);font-size:14px;line-height:1.5;margin:0 0 18px}.builds{border:1px solid var(--line);border-radius:18px;overflow:hidden;background:var(--panel)}.build{padding:21px}.build+.build{border-top:1px solid var(--line)}.buildHead{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:8px}.buildName{font-size:17px;font-weight:800}.version{color:var(--muted);font:12px ui-monospace,SFMono-Regular,Menlo,monospace}.description{color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 16px}.install{display:flex;align-items:center;justify-content:center;width:100%;min-height:50px;border-radius:12px;background:var(--accent);color:var(--accentText);font-weight:850;text-decoration:none;font-size:15px}.secondary{background:transparent;color:var(--accent);border:1px solid var(--accent)}.install:active{transform:scale(.987);filter:brightness(.92)}.foot{color:#7f899f;font-size:11px;text-align:center;margin-top:20px}@media(prefers-color-scheme:light){:root{--bg:#f4f0e8;--panel:#fff;--line:#d8d4cc;--text:#1b2746;--muted:#687085;--accent:#e86d0b;--accentText:#fff}.icon{box-shadow:0 8px 24px #1b274622}.secondary{color:var(--accentText);background:var(--accent)}.foot{color:#7a8190}}
</style></head><body><main><div class="brand"><img class="icon" src="icon.png" alt="Vito app icon" /><div><p class="eyebrow">Private distribution</p><h1 class="title">Install Vito</h1></div></div><p class="intro">Choose the build that fits the job. Both are compiled locally and signed for your registered iPhone.</p><section class="builds">${cards}</section><p class="foot">Open in Safari · pHouse Productions internal distribution</p></main></body></html>\n`;
}

function publish(profile, ipaPath, metadata) {
  const targetDir = join(buildsRoot, `vito-${profile}`);
  mkdirSync(targetDir, { recursive: true });
  mkdirSync(canonicalDir, { recursive: true });
  const ipaName = `vito-${profile}.ipa`;
  copyFileSync(ipaPath, join(targetDir, ipaName));
  copyFileSync(join(mobileDir, "assets", "icon.png"), join(targetDir, "icon.png"));
  copyFileSync(join(mobileDir, "assets", "icon.png"), join(canonicalDir, "icon.png"));
  writeAtomic(join(targetDir, ".meta.json"), '{"isPublic":true}\n');
  writeAtomic(join(canonicalDir, ".meta.json"), '{"isPublic":true}\n');
  writeAtomic(join(targetDir, "manifest.plist"), manifestPlist({ profile, buildNumber: metadata.buildNumber, bundleIdentifier: metadata.bundleIdentifier }));
  writeAtomic(join(targetDir, "index.html"), installerHtml({ profile, version: metadata.version, buildNumber: metadata.buildNumber }));

  const builds = loadBuildMetadata();
  builds[profile] = { ...metadata, profile, publishedAt: new Date().toISOString(), ipa: ipaName };
  writeAtomic(join(canonicalDir, "builds.json"), `${JSON.stringify(builds, null, 2)}\n`);
  writeAtomic(join(canonicalDir, "index.html"), selectorHtml(builds));

  const oldRoot = join(buildsRoot, "rook");
  mkdirSync(oldRoot, { recursive: true });
  writeAtomic(join(oldRoot, ".meta.json"), '{"isPublic":true}\n');
  writeAtomic(join(oldRoot, "index.html"), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/d/builds/vito/"><title>Vito builds</title><a href="/d/builds/vito/">Continue to Vito builds</a>\n');
}

async function verifyPublished(profile, buildNumber) {
  const urls = [
    `${baseUrl}/d/builds/vito/`,
    `${baseUrl}/d/builds/vito-${profile}/manifest.plist?build=${buildNumber}`,
    `${baseUrl}/d/builds/vito-${profile}/vito-${profile}.ipa?build=${buildNumber}`,
  ];
  for (const url of urls) {
    let response;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      response = await fetch(url, url.endsWith(`ipa?build=${buildNumber}`) ? { headers: { Range: "bytes=0-0" } } : undefined);
      if (response.ok || response.status === 206) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    }
    if (!response || (!response.ok && response.status !== 206)) throw new Error(`Published URL failed: ${url} (${response?.status ?? "no response"})`);
    await response.body?.cancel();
  }
}

const config = readJson(configPath);
const baseDomain = config.apps?.baseDomain;
if (!baseDomain) throw new Error("apps.baseDomain is not configured");
const baseUrl = `https://${baseDomain}`;

verifyToolchain();
mkdirSync(join(mobileDir, "builds"), { recursive: true });
const results = [];
for (const profile of profiles) {
  const { app, buildNumber } = nextBuildNumber();
  const version = String(app.expo.version);
  const outputPath = resolve(mobileDir, "builds", `vito-${profile}-${buildNumber}.ipa`);
  rmSync(outputPath, { force: true });
  run("npx", ["eas-cli", "build", "--local", "--platform", "ios", "--profile", profile, "--output", outputPath, "--non-interactive"], { cwd: mobileDir });
  if (!existsSync(outputPath)) throw new Error(`Build completed without producing ${outputPath}`);
  const metadata = extractIpaMetadata(outputPath);
  if (metadata.bundleIdentifier !== app.expo.ios.bundleIdentifier) throw new Error(`Bundle identifier mismatch: ${metadata.bundleIdentifier}`);
  if (metadata.buildNumber !== buildNumber) throw new Error(`Build number mismatch: expected ${buildNumber}, got ${metadata.buildNumber}`);
  if (metadata.version !== version) throw new Error(`Version mismatch: expected ${version}, got ${metadata.version}`);
  publish(profile, outputPath, metadata);
  await verifyPublished(profile, buildNumber);
  results.push({ profile, ...metadata, outputPath });
}

console.log("\nLocal Vito builds published successfully:");
for (const result of results) console.log(`- ${result.profile}: ${result.version} (${result.buildNumber}) ${basename(result.outputPath)}`);
console.log(`${baseUrl}/d/builds/vito/`);
