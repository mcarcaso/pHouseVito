"""Real Git/SQLite fake data; mocked npm, PM2 and network deployment checks."""
import importlib.util
from pathlib import Path
import sqlite3
import subprocess
import tempfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("deployment", "aws_deploy/update-source.py")
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)


def git(path, *args):
    return subprocess.check_output(["git", "-C", str(path), *args], stderr=subprocess.DEVNULL).decode().strip()


with tempfile.TemporaryDirectory(prefix="vito-source-tests-") as temporary:
    root = Path(temporary).resolve()
    installation = root / "installation"
    old = installation / "checkouts" / "old"
    old.mkdir(parents=True)
    git(old, "init", "-b", "main")
    git(old, "config", "user.email", "fixture@example.invalid")
    git(old, "config", "user.name", "fixture")
    (old / ".gitignore").write_text("/user\n")
    (old / "scripts").mkdir()
    (old / "scripts/run-source.sh").write_text("#!/bin/sh\n")
    (old / "source.txt").write_text("old")
    git(old, "add", ".")
    git(old, "commit", "-m", "old")
    previous = git(old, "rev-parse", "HEAD")
    (old / "source.txt").write_text("new")
    git(old, "commit", "-am", "new")
    revision = git(old, "rev-parse", "HEAD")
    git(old, "update-ref", "refs/remotes/origin/main", revision)
    git(old, "checkout", "--detach", previous)
    git(old, "remote", "add", "origin", d.REPOSITORY)
    user = root / "persistent-user"
    user.mkdir()
    (old / "user").symlink_to(user)
    (installation / "current").symlink_to(old)
    (user / "vito.config.json").write_text("{}")
    db = sqlite3.connect(user / "vito.db")
    db.execute("pragma journal_mode=WAL")
    db.execute("create table messages(content text)")
    db.execute("insert into messages values('live WAL data')")
    db.commit()
    log = user / "service.log"
    log.write_text("")
    apps = [{"name": "client-app", "pid": 123, "pm2_env": {"status": "online"}}]
    rows = apps + [{"name": "vito-server", "pid": 456, "pm2_env": {"status": "online"}}]
    env = rows[-1]["pm2_env"]
    env["pm_out_log_path"] = str(log)
    calls = []
    real_run = d.run
    fail_build = False
    fail_health = False

    def run(*args, **kwargs):
        calls.append(args)
        if args[:2] == ("git", "fetch"):
            return ""
        if args[0] == "npm":
            if fail_build:
                raise RuntimeError("simulated build failure")
            return ""
        if args[0] == "./vito":
            return ""
        if args[0] == "pm2":
            if args[1] == "restart":
                with log.open("a") as output:
                    output.write("Vito is ready.\n")
            return ""
        return real_run(*args, **kwargs)

    def health(url, expected, attempts=60):
        if fail_health and expected == revision:
            raise RuntimeError("simulated bad new health")

    with patch.object(d, "run", run), patch.object(d, "processes", lambda: rows), \
            patch.object(d, "running_cwd", lambda pid: (installation / "current").resolve()), \
            patch.object(d, "health", health), patch.object(Path, "home", lambda: root):
        (old / "source.txt").write_text("agent edit")
        try:
            d.update(installation, old, rows, env, "https://fixture.invalid/api/health")
            raise AssertionError("dirty source accepted")
        except RuntimeError as error:
            assert "Local source edits" in str(error)
        assert not any(call[0] in ("npm", "pm2") for call in calls)
        assert (old / "source.txt").read_text() == "agent edit"
        git(old, "checkout", "--", "source.txt")
        fail_build = True
        calls.clear()
        try:
            d.update(installation, old, rows, env, "https://fixture.invalid/api/health")
            raise AssertionError("build failure accepted")
        except RuntimeError:
            pass
        assert not any(call[0] == "pm2" for call in calls)
        assert (installation / "current").resolve() == old
        fail_build = False
        fail_health = True
        calls.clear()
        try:
            d.update(installation, old, rows, env, "https://fixture.invalid/api/health")
            raise AssertionError("bad health accepted")
        except RuntimeError:
            pass
        assert (installation / "current").resolve() == old
        assert db.execute("select content from messages").fetchone()[0] == "live WAL data"
        assert [c for c in calls if c[:2] == ("pm2", "restart")] == [("pm2", "restart", "vito-server")] * 2
        fail_health = False
        calls.clear()
        d.update(installation, old, rows, env, "https://fixture.invalid/api/health")
        candidate = (installation / "current").resolve()
        assert candidate != old
        assert git(candidate, "rev-parse", "HEAD") == revision
        assert git(candidate, "branch", "--show-current") == "main"
        assert (candidate / "user").resolve() == user
        assert (old / "source.txt").read_text() == "old"
        assert all(c[2] == "vito-server" for c in calls if c[:2] in (("pm2", "stop"), ("pm2", "restart")))
        for backup in (root / "vito-backups/source-deploys").glob("*/vito.db"):
            with sqlite3.connect(backup) as copied:
                assert copied.execute("select content from messages").fetchone()[0] == "live WAL data"
        assert apps[0]["pid"] == 123
        calls.clear()
        d.update(installation, candidate, rows, env, "https://fixture.invalid/api/health")
        assert not any(c[0] in ("npm", "pm2") for c in calls)
    db.close()
print("source deployment scenarios passed")
