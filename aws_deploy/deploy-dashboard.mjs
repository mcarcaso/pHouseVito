import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [directory, ...names] = process.argv.slice(2);
const escape = (value) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );

function render() {
  const running = existsSync(join(directory, ".running"));
  const panes = names
    .map((name) => {
      const status = readFileSync(join(directory, `${name}.status`), "utf8").trim();
      const log = readFileSync(join(directory, `${name}.log`), "utf8")
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
        .split("\n")
        .slice(-250)
        .join("\n");
      return `<section><header><strong>${escape(name)}</strong><span class="${escape(status)}">${escape(status)}</span><a href="${encodeURIComponent(name)}.log" target="_blank">Full log ↗</a></header><pre>${escape(log) || "Waiting for output…"}</pre></section>`;
    })
    .join("\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${running ? '<meta http-equiv="refresh" content="2">' : ""}
<title>Vito deployments</title><style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#10151e;color:#e5eaf3;font:15px system-ui,sans-serif}h1{margin:0 0 8px;font-size:24px}p{color:#9baac0;margin:0 0 24px}.panes{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,480px),1fr));gap:16px}section{background:#171f2c;border:1px solid #2c3b50;border-radius:10px;overflow:hidden}header{display:flex;align-items:center;gap:14px;padding:14px;border-bottom:1px solid #2c3b50}header strong{font-size:17px}header span{font-size:12px;text-transform:uppercase}.running{color:#8cbcff}.succeeded{color:#7ee2ad}.failed{color:#ff9393}a{margin-left:auto;color:#a7c9ff;font-size:13px}pre{margin:0;padding:16px;height:360px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace}
</style></head><body><h1>Vito deployments</h1><p>${running ? "Live · refreshes every 2 seconds" : "Finished · logs saved"} · Updated ${escape(new Date().toLocaleTimeString())} · Each pane shows the latest 250 lines.</p><main class="panes">${panes}</main><script>document.querySelectorAll('pre').forEach(p=>p.scrollTop=p.scrollHeight);</script></body></html>`;
  const path = join(directory, "index.html");
  writeFileSync(`${path}.tmp`, html, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
  return running;
}

if (render()) {
  const timer = setInterval(() => {
    if (!render()) clearInterval(timer);
  }, 1000);
}
