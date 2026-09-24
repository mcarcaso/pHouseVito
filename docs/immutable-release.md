# Immutable Vito release (initial implementation)

This is a **Node release bundle**, not a single executable or sandbox. It is built for the target OS/CPU and compatible Node ABI because `better-sqlite3` is native. Pi, browser automation, and user apps may need other native/runtime dependencies. Do not send the macOS bundle to Linux.

## Build and install (offline pilot)

On a build host with the target architecture and Node >=22.19, Python 3 (archive validation) and network access to npm:

```bash
scripts/build-release.sh <unique-version> /path/to/artifacts
scripts/install-release.sh /path/to/artifacts/vito-<version>-<os>-<arch>.tar.gz /opt/vito-managed
scripts/manage-release.sh /opt/vito-managed verify <version>
scripts/manage-release.sh /opt/vito-managed activate <version>
# After operator-controlled service restart, verify real health; if needed:
scripts/manage-release.sh /opt/vito-managed rollback
# Restart the service under the operator's control to take effect.
```

The builder snapshots only required source/build inputs under a temporary directory, installs and builds there, and **never exports web assets into the live source tree**. It refuses dirty source by default; `ALLOW_DIRTY_RELEASE=1` is exclusively for a local disposable pilot, not distribution. Bundle builds still require matching target OS/architecture and compatible Node ABI.

The installer checks platform/Node major, verifies the adjacent SHA-256, validates tar member/link paths and size limits, installs to `releases/vito-<version>`, and creates persistent `data/user` only on first install. It verifies release layout plus native SQLite before activation. It does **not** restart or activate the service by default. Use `manage-release.sh activate` (or installer `--activate`) to atomically set `current` and preserve `previous` for rollback. `rollback` changes the pointer only; a process already running from the prior release still needs an operator-controlled restart. Operators own health verification and service cutover. Back up `data/user` independently before migration. Never point a release at production data for a smoke test.

Run from a release directory with `./run.sh` (or configure PM2/systemd to execute that launcher with its cwd at that release). Use bundled `./vito` for memory/config/jobs commands. The launcher sets external paths for Pi agent configuration, logs and attachments. The compiled job worker is selected as `.js` for the bundled runtime while source development still uses `.ts`. `system/skills` is release-owned; `user/skills` lives in `data/user` and overrides bundled skills by name. Skills with scripts remain actual files so relative paths resolve. Release files are marked read-only as a guard against accidental edits; **a separate release-owning OS user and a distinct non-root runtime user are required for real enforcement**. The runtime user needs write access only to `data/user`. Do not grant it sudo or write access to releases/current. `--activate` does not change a running process's cwd; use a controlled service restart after cutover.

The artifact is a tarball of compiled `dist`, `mobile/dist`, `system`, `user.example`, the pinned production npm dependency tree and launch script. **It excludes the real `user` directory, database, credentials and customer apps.** Check third-party license/redistribution requirements before distributing. Install Chromium and OS dependencies separately on Linux using the release's Playwright CLIs, on the target host; they are not embedded in the bundle. Provide a client-owned Pi OAuth setup under `data/user/pi-agent` rather than copying the developer's credentials.

## Local installer-executable pilot

`scripts/build-installer.mjs <release.tar.gz> <output>` builds a Node SEA **installer**, embedding the versioned release archive and the install/validate/manage scripts. It needs a target-platform Node 24 build host and a pinned postject CLI supplied through `POSTJECT_BIN`; the macOS build is ad-hoc signed **for local execution only**, not distribution. Set `ALLOW_DIRTY_INSTALLER=1` only when wrapping a dirty local-pilot archive; a distributable installer must use a clean committed revision and a real signing/provenance workflow. The installer supports `doctor`, `install <root> [--activate]`, `status <root>`, `verify <root> <version>`, `activate <root> <version>` and `rollback <root>`. It does not restart any service.

The local macOS x64 pilot produced a ~307 MB executable. Under `/tmp` it passed prerequisite checks, installed its embedded bundle, verified native SQLite, launched the bundled CLI and job worker, and preserved fake user data through activation/rollback between two versions. A Linux x64 pilot built on a disposable Hetzner Ubuntu 24.04 VM passed installation **from the binary alone** on a separate clean Ubuntu VM with Node 24.13.0, no source checkout, and no compiler: CLI/config validation, native SQLite, dashboard health, bundled skills, job-worker IPC, traversal rejection, fake-data upgrade and rollback all passed. Both VMs and their firewall, key, and primary IPs were deleted. The Linux release was built from a Git archive re-committed on the VM: its internal `RELEASE_INFO` revision is the synthetic snapshot revision, **not** the original source commit named in the archive, so this pilot must not be distributed. No model/API turn or real client/production cutover was attempted. The installer currently **checks** for Bash, tar, Python 3, shasum and matching Node, but does **not install** Node, browser/OS libraries, establish OS users or install PM2/systemd services. A machine lacking a prerequisite gets a clear failure, not an automatic privileged installation.

## Not yet done

The existing `aws_deploy/deploy.sh` still pulls source and builds on the customer VM; it has **not** been switched to this release flow. A macOS pilot built from a dirty working tree (`ALLOW_DIRTY_RELEASE=1`) was tested only under `/tmp`; never distribute that artifact. Authenticated artifact provenance, real signing, pinned/reproducible installer tooling, OS-user permissions, separately scoped credential onboarding and one model/persistence turn, browser provisioning, and PM2 cutover/rollback verification remain before client deployment. The adjacent SHA-256 detects corruption, not a malicious replacement of both files. The installer binary is distribution packaging, **not a security sandbox** or a self-contained Vito runtime.
