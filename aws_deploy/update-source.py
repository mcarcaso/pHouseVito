"""Pull main and run the existing restart workflow on one source deployment."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

REPOSITORY = "https://github.com/mcarcaso/pHouseVito.git"
SERVICE = "vito-server"


def run(*args, cwd=None, timeout=180):
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr.strip() or result.stdout.strip()}")
    return result.stdout.strip()


def processes():
    return json.loads(run("pm2", "jlist"))


def other_apps(rows):
    return {row["name"]: (row["pid"], row["pm2_env"]["status"])
            for row in rows if row["name"] != SERVICE}


def running_cwd(pid):
    return Path(f"/proc/{pid}/cwd").resolve()


def health_matches(url, revision):
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            data = json.load(response)
        return data.get("status") == "ok" and data.get("revision") == revision
    except (OSError, ValueError):
        return False


def health(url, revision):
    for _ in range(60):
        if health_matches(url, revision):
            return
        time.sleep(1)
    raise RuntimeError("Exact revision health check failed; inspect pm2 logs vito-server --lines 50 --nostream")


def update(root, checkout, rows, public_url):
    if run("git", "status", "--porcelain", cwd=checkout):
        raise RuntimeError("Local source edits exist; reconcile them before deploying")
    if run("git", "remote", "get-url", "origin", cwd=checkout) != REPOSITORY:
        raise RuntimeError("Unexpected origin repository")
    branch = run("git", "branch", "--show-current", cwd=checkout)
    if branch != "main":
        raise RuntimeError(f"Checkout is not on main (current: {branch or 'detached HEAD'}); switch to main before deploying")
    user = (checkout / "user").resolve()
    if not (checkout / "user").is_symlink() or not user.is_dir() or user.is_relative_to(root / "checkouts"):
        raise RuntimeError("Expected persistent user data outside source checkouts")
    if not (checkout / "scripts/restart-vito.sh").is_file():
        raise RuntimeError("Source restart script missing")

    previous = run("git", "rev-parse", "HEAD", cwd=checkout)
    print("Pulling latest main into the current checkout", flush=True)
    run("git", "pull", "--ff-only", "origin", "main", cwd=checkout)
    revision = run("git", "rev-parse", "HEAD", cwd=checkout)
    if (checkout / "user").resolve() != user:
        raise RuntimeError("Persistent user path changed")
    if (previous == revision
            and health_matches("http://127.0.0.1:3030/api/health", revision)
            and health_matches(public_url, revision)):
        print("Already running latest main; skipping build and restart", flush=True)
        print(json.dumps({"state": "unchanged", "revision": revision, "checkout": str(checkout)}), flush=True)
        return
    os.environ.setdefault("NODE_OPTIONS", os.environ.get("VITO_BUILD_NODE_OPTIONS", "--max-old-space-size=1536"))
    print("Building and restarting only Vito", flush=True)
    # SSH owns this process, so it survives the Vito PM2 restart.
    subprocess.run(["./scripts/restart-vito.sh"], cwd=checkout, check=True, timeout=1800)
    health("http://127.0.0.1:3030/api/health", revision)
    health(public_url, revision)
    after = processes()
    vito = next(row for row in after if row["name"] == SERVICE)
    if vito["pm2_env"]["status"] != "online" or running_cwd(vito["pid"]) != checkout:
        raise RuntimeError("Vito process does not match the source checkout")
    if other_apps(after) != other_apps(rows):
        raise RuntimeError("Unrelated PM2 app status changed")
    run("pm2", "save")
    print(json.dumps({"state": "succeeded", "revision": revision, "checkout": str(checkout)}), flush=True)


def main(public_url):
    version = tuple(int(part) for part in run("node", "-p", "process.versions.node").split("."))
    if version[0] not in (22, 24) or (version[0] == 22 and version[1] < 19):
        raise RuntimeError("Source deployment requires Node 22.19+ or Node 24")
    rows = processes()
    entries = [row for row in rows if row["name"] == SERVICE]
    if len(entries) != 1 or entries[0]["pm2_env"]["status"] != "online":
        raise RuntimeError("Expected exactly one online Vito service")
    entry = entries[0]
    env = entry["pm2_env"]
    root = Path(env["pm_cwd"]).resolve()
    checkout = (root / "current").resolve()
    if (env["pm_exec_path"] != str(root / "run-current.sh")
            or not (root / "current").is_symlink()
            or checkout.parent != root / "checkouts"
            or not (checkout / ".git").is_dir()
            or running_cwd(entry["pid"]) != checkout):
        raise RuntimeError("Expected a provisioned source deployment")
    with (root / ".deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        update(root, checkout, rows, public_url)


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2 or not sys.argv[1].startswith("https://"):
            raise RuntimeError("Expected public HTTPS health URL")
        main(sys.argv[1])
    except Exception as error:
        print("Deployment failed: " + str(error), file=sys.stderr)
        sys.exit(1)
