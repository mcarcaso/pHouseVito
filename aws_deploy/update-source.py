"""Update a prepared source installation. Run over SSH as its PM2 owner."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.request
import uuid

REPOSITORY = "https://github.com/mcarcaso/pHouseVito.git"
SERVICE = "vito-server"


def run(*args, cwd=None, log=None, timeout=180):
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if log:
        with log.open("a") as output:
            output.write(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed (exit {result.returncode}); inspect private deployment log")
    return result.stdout.strip()


def running_cwd(pid):
    return Path(f"/proc/{pid}/cwd").resolve()


def processes():
    return json.loads(run("pm2", "jlist"))


def other_apps(rows):
    return {row["name"]: (row["pid"], row["pm2_env"]["status"])
            for row in rows if row["name"] != SERVICE}


def health(url, expected, attempts=60):
    for _ in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                data = json.load(response)
            if data.get("status") == "ok" and data.get("revision") == expected:
                return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise RuntimeError("Exact revision health check failed")


def snapshot(user, destination):
    for name in ("vito.db", "embeddings.db"):
        if not (user / name).exists():
            continue
        with sqlite3.connect((user / name).as_uri() + "?mode=ro", uri=True) as source:
            with sqlite3.connect(destination / name) as target:
                source.backup(target)
                if target.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                    raise RuntimeError("Backup integrity check failed")
    for name in ("vito.config.json", "secrets.json", "SOUL.md", "profile.md", "profile.json"):
        source = user / name
        if source.exists():
            shutil.copy2(source, destination / name)
    for name in ("pi-sessions", "pi-agent"):
        if (user / name).exists():
            shutil.copytree(user / name, destination / name, symlinks=True)
    for item in destination.rglob("*"):
        if not item.is_symlink():
            item.chmod(0o700 if item.is_dir() else 0o600)


def switch(root, target):
    temporary = root / (".current-" + uuid.uuid4().hex)
    temporary.symlink_to(target)
    os.replace(temporary, root / "current")


def activate(root, candidate, old, revision, old_revision, user, backup, public_url, others, log_path):
    """Rollback code only if any post-stop check fails; never restore live data."""
    stopped = False
    offset = log_path.stat().st_size if log_path.exists() else 0
    try:
        stopped = True
        run("pm2", "stop", SERVICE)
        snapshot(user, backup)
        switch(root, candidate)
        run("pm2", "restart", SERVICE)
        health("http://127.0.0.1:3030/api/health", revision)
        for _ in range(60):
            startup = log_path.read_bytes()[offset:] if log_path.exists() else b""
            if b"Vito is ready." in startup:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Channels did not finish startup")
        (backup / "startup.log").write_bytes(startup)
        health(public_url, revision, attempts=3)
        for name in ("vito.db", "embeddings.db"):
            if (user / name).exists():
                with sqlite3.connect((user / name).as_uri() + "?mode=ro", uri=True) as db:
                    if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                        raise RuntimeError("Live database integrity check failed")
        run("./vito", "config", "validate", str(user / "vito.config.json"), cwd=candidate, log=backup / "deployment.log")
        rows = processes()
        entry = next(row for row in rows if row["name"] == SERVICE)
        actual_cwd = running_cwd(entry["pid"])
        if actual_cwd != candidate or other_apps(rows) != others:
            raise RuntimeError("Process identity or unrelated app status changed")
        run("pm2", "save")
    except BaseException:
        if stopped:
            run("pm2", "stop", SERVICE)
            switch(root, old)
            run("pm2", "restart", SERVICE)
            health("http://127.0.0.1:3030/api/health", old_revision)
            run("pm2", "save")
            print("Previous source restored; user data was not restored", flush=True)
        raise


def main(public_url):
    os.umask(0o077)
    version = tuple(int(part) for part in run("node", "-p", "process.versions.node").split("."))
    if version[0] not in (22, 24) or (version[0] == 22 and version[1] < 19):
        raise RuntimeError("Source deployment requires Node 22.19+ or Node 24; review other majors separately")
    rows = processes()
    entries = [row for row in rows if row["name"] == SERVICE]
    if len(entries) != 1 or entries[0]["pm2_env"]["status"] != "online":
        raise RuntimeError("Expected exactly one online Vito service")
    entry = entries[0]
    env = entry["pm2_env"]
    root = Path(env["pm_cwd"]).resolve()
    old = (root / "current").resolve()
    if (env["pm_exec_path"] != str(root / "run-current.sh")
            or not (root / "current").is_symlink()
            or old.parent != root / "checkouts"
            or not (old / ".git").is_dir()
            or not (old / "scripts/run-source.sh").is_file()):
        raise RuntimeError("Source deployment requires reviewed initial provisioning; no automatic migration")
    if running_cwd(entry["pid"]) != old:
        raise RuntimeError("Running checkout does not match current")
    with (root / ".deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        update(root, old, rows, env, public_url)


def update(root, old, rows, env, public_url):
    if run("git", "status", "--porcelain", cwd=old):
        raise RuntimeError("Local source edits exist; reconcile them before deploying")
    remote = run("git", "remote", "get-url", "origin", cwd=old)
    if remote != REPOSITORY:
        raise RuntimeError("Unexpected origin repository; inspect it before deployment")
    old_revision = run("git", "rev-parse", "HEAD", cwd=old)
    health("http://127.0.0.1:3030/api/health", old_revision, attempts=1)
    run("git", "fetch", "origin", "+refs/heads/main:refs/remotes/origin/main", cwd=old)
    revision = run("git", "rev-parse", "origin/main", cwd=old)
    if revision == old_revision:
        print("Already running latest main; no restart")
        return
    if run("git", "ls-tree", "--name-only", revision, "user", cwd=old):
        raise RuntimeError("Target main tracks user data; review before deploying")
    user = (old / "user").resolve()
    if not (old / "user").is_symlink() or not user.is_dir() or user.is_relative_to(root / "checkouts"):
        raise RuntimeError("Persistent user data must be external to source checkouts")
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + uuid.uuid4().hex[:8]
    backup = Path.home() / "vito-backups" / "source-deploys" / stamp
    backup.mkdir(parents=True, mode=0o700)
    (backup / "pm2-before.json").write_text(json.dumps(rows))
    log = backup / "deployment.log"
    candidate = root / "checkouts" / ("source-" + revision[:12] + "-" + stamp)
    print("Preparing main " + revision + " while Vito remains online", flush=True)
    run("git", "clone", "--no-hardlinks", "--no-checkout", str(old), str(candidate), log=log)
    run("git", "remote", "set-url", "origin", REPOSITORY, cwd=candidate)
    run("git", "checkout", "-B", "main", revision, cwd=candidate, log=log)
    run("git", "update-ref", "refs/remotes/origin/main", revision, cwd=candidate)
    run("git", "branch", "--set-upstream-to=origin/main", "main", cwd=candidate)
    (candidate / "user").symlink_to(user)
    # Build only in the inactive checkout; do not run smoke tests on client data.
    if not (candidate / "scripts/run-source.sh").is_file():
        raise RuntimeError("Target main does not support the source launcher; merge source deployment changes first")
    os.environ.setdefault("NODE_OPTIONS", os.environ.get("VITO_BUILD_NODE_OPTIONS", "--max-old-space-size=768"))
    for args in (("npm", "ci", "--include=dev"),
                 ("npm", "--prefix", "mobile", "ci", "--include=dev"),
                 ("npm", "run", "build"), ("npm", "run", "build:mobile:web")):
        run(*args, cwd=candidate, log=log, timeout=1800)
    run("./vito", "config", "validate", str(user / "vito.config.json"), cwd=candidate, log=log)
    if run("git", "status", "--porcelain", cwd=candidate):
        raise RuntimeError("Prepared checkout is dirty")
    if run("git", "status", "--porcelain", cwd=old):
        raise RuntimeError("Local source changed during preparation")
    latest_rows = processes()
    latest_vito = [row for row in latest_rows if row["name"] == SERVICE]
    original_vito = [row for row in rows if row["name"] == SERVICE]
    if ((root / "current").resolve() != old
            or other_apps(latest_rows) != other_apps(rows)
            or len(latest_vito) != 1
            or latest_vito[0]["pid"] != original_vito[0]["pid"]
            or any(latest_vito[0]["pm2_env"].get(key) != env.get(key)
                   for key in ("pm_exec_path", "pm_cwd", "env", "status", "restart_time"))):
        raise RuntimeError("Deployment state changed during preparation")
    started = time.monotonic()
    activate(root, candidate, old, revision, old_revision, user, backup, public_url,
             other_apps(rows), Path(env["pm_out_log_path"]))
    result = {"state": "succeeded", "revision": revision, "checkout": str(candidate),
              "previous_checkout": str(old), "backup": str(backup),
              "seconds_until_verified": round(time.monotonic() - started, 1)}
    (backup / "RESULT.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    def interrupted(signum, frame):
        raise RuntimeError("Deployment interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        if len(sys.argv) != 2 or not sys.argv[1].startswith("https://"):
            raise RuntimeError("Expected public HTTPS health URL")
        main(sys.argv[1])
    except Exception as error:
        print("Deployment failed: " + str(error), file=sys.stderr)
        sys.exit(1)
