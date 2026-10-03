"""Real fast-forward Git updates and fake restarts; no live data or network."""
import importlib.util
from pathlib import Path
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
    origin = root / "origin"
    origin.mkdir()
    git(origin, "init", "-b", "main")
    git(origin, "config", "user.email", "fixture@example.invalid")
    git(origin, "config", "user.name", "fixture")
    (origin / ".gitignore").write_text("/user\n")
    (origin / "scripts").mkdir()
    (origin / "scripts/restart-vito.sh").write_text(
        "#!/bin/sh\nset -e\n[ ! -e user/fail-build ] || exit 1\necho restart >> user/restarts\n"
    )
    (origin / "scripts/restart-vito.sh").chmod(0o755)
    (origin / "source.txt").write_text("old")
    git(origin, "add", ".")
    git(origin, "commit", "-m", "old")
    installation = root / "installation"
    checkout = installation / "checkouts/current"
    checkout.parent.mkdir(parents=True)
    subprocess.check_call(["git", "clone", str(origin), str(checkout)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    previous = git(checkout, "rev-parse", "HEAD")
    (origin / "source.txt").write_text("new")
    git(origin, "commit", "-am", "new")
    revision = git(origin, "rev-parse", "HEAD")
    user = root / "persistent-user"
    user.mkdir()
    (checkout / "user").symlink_to(user)
    (installation / "current").symlink_to(checkout)
    (user / "sentinel").write_text("live user data")
    apps = [{"name": "client-app", "pid": 123, "pm2_env": {"status": "online"}}]
    rows = apps + [{"name": "vito-server", "pid": 456, "pm2_env": {"status": "online"}}]
    calls = []
    health_calls = []
    running_revision = previous
    real_run = d.run

    def run(*args, **kwargs):
        calls.append(args)
        if args[0] == "pm2":
            return ""
        return real_run(*args, **kwargs)

    with patch.object(d, "REPOSITORY", str(origin)), patch.object(d, "run", run), \
            patch.object(d, "processes", lambda: rows), \
            patch.object(d, "running_cwd", lambda pid: checkout), \
            patch.object(d, "health_matches", lambda url, rev: running_revision == rev), \
            patch.object(d, "health", lambda url, rev: health_calls.append((url, rev))):
        (checkout / "source.txt").write_text("agent edit")
        try:
            d.update(installation, checkout, rows, "https://fixture.invalid/api/health")
            raise AssertionError("dirty source accepted")
        except RuntimeError as error:
            assert "Local source edits" in str(error)
        assert (checkout / "source.txt").read_text() == "agent edit"
        assert not (user / "restarts").exists()
        git(checkout, "checkout", "--", "source.txt")

        # Wrong branches and detached HEAD fail before pulling or restarting.
        for branch in ("feature-fixture", None):
            if branch:
                git(checkout, "checkout", "-b", branch)
            else:
                git(checkout, "checkout", "--detach")
            calls.clear()
            try:
                d.update(installation, checkout, rows, "https://fixture.invalid/api/health")
                raise AssertionError("non-main checkout accepted")
            except RuntimeError as error:
                assert "not on main" in str(error)
                assert (branch or "detached HEAD") in str(error)
            assert not any(c[:2] == ("git", "pull") for c in calls)
            assert not (user / "restarts").exists()
            git(checkout, "checkout", "main")

        # Build failure leaves pulled code in place and does not restart.
        (user / "fail-build").touch()
        try:
            d.update(installation, checkout, rows, "https://fixture.invalid/api/health")
            raise AssertionError("build failure accepted")
        except subprocess.CalledProcessError:
            pass
        assert git(checkout, "rev-parse", "HEAD") == revision
        assert not (user / "restarts").exists()
        assert not health_calls
        (user / "fail-build").unlink()

        # Already-pulled code must still build/restart, not fail a preflight health check.
        d.update(installation, checkout, rows, "https://fixture.invalid/api/health")
        assert (user / "restarts").read_text().splitlines() == ["restart"]
        assert health_calls == [("http://127.0.0.1:3030/api/health", revision), ("https://fixture.invalid/api/health", revision)]
        assert (installation / "current").resolve() == checkout
        assert (checkout / "user").resolve() == user
        assert (user / "sentinel").read_text() == "live user data"
        assert len(list(checkout.parent.iterdir())) == 1
        assert not (root / "vito-backups").exists()
        assert not any(c[:2] in (("pm2", "stop"), ("pm2", "restart")) for c in calls)

        # Matching checkout and running revision skip build/restart even if a build would fail.
        running_revision = revision
        (user / "fail-build").touch()
        calls.clear()
        health_calls.clear()
        d.update(installation, checkout, rows, "https://fixture.invalid/api/health")
        assert (user / "restarts").read_text().splitlines() == ["restart"]
        assert not health_calls
        assert not any(c[0] == "pm2" for c in calls)
        (user / "fail-build").unlink()

        # A stale public revision must not skip the restart workflow.
        with patch.object(d, "health_matches", lambda url, rev: url.startswith("http://127.")):
            d.update(installation, checkout, rows, "https://fixture.invalid/api/health")
        assert (user / "restarts").read_text().splitlines() == ["restart", "restart"]

        # Divergent local commits are preserved and refuse pull before restart.
        git(checkout, "config", "user.email", "fixture@example.invalid")
        git(checkout, "config", "user.name", "fixture")
        (checkout / "local.txt").write_text("local commit")
        git(checkout, "add", "local.txt")
        git(checkout, "commit", "-m", "local")
        local = git(checkout, "rev-parse", "HEAD")
        (origin / "source.txt").write_text("newer")
        git(origin, "commit", "-am", "newer")
        try:
            d.update(installation, checkout, rows, "https://fixture.invalid/api/health")
            raise AssertionError("divergence accepted")
        except RuntimeError:
            pass
        assert git(checkout, "rev-parse", "HEAD") == local
        assert (user / "restarts").read_text().splitlines() == ["restart", "restart"]
print("source deployment scenarios passed")
