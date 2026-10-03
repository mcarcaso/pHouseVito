# Deploying Vito from source

Vito runs from an editable Git checkout with backend and mobile development dependencies installed. Client state lives outside the checkout. Agents can work on source, while the owner controls deployment and restart.

## Agent updates

The owner can ask their agent to update from `main`. The workflow in `system/SYSTEM.md` is ordinary Git: check the current checkout and local edits, then run `git pull --ff-only origin main`. The agent reports the revision and asks the owner to run `/restart`. Pulling alone does not install dependencies, rebuild the web client, or restart the running process.

The existing `/restart` workflow synchronizes dependencies, builds the backend and web client (web builds use a separate staging directory), and restarts only `vito-server`. It does not pull Git. There is no separate self-update service. Conflicting edits or divergent Git history require reconciliation, and user data and credentials remain in their existing persistent directory.

## Update one client

After approving that client's update and downtime:

```bash
./aws_deploy/deploy.sh mar
```

The command reads that client's local `aws_deploy/state/<name>.json`, uses the existing SSH key (`~/.ssh/vito-deploy.pem`, or `VITO_SSH_KEY`), and requires a trusted known-host entry. It sends no operator deployment credentials to the client.

On the host it discovers the existing Vito PM2 installation and:

1. Checks the source launcher, clean `main` checkout, expected Git origin, and external persistent user path.
2. Runs `git pull --ff-only origin main` in that existing checkout.
3. Runs `scripts/restart-vito.sh`: sync dependencies when needed, build backend, build web into a temporary staging directory, publish web assets, then restart only `vito-server`.
4. Checks exact local/public health revision, running checkout, and unchanged other PM2 apps; then saves PM2.

If the pull leaves the revision unchanged and both local and public health already report that exact healthy revision, deployment skips dependency installation, builds, and restart. Already-pulled code still runs the restart workflow when the service is running an older revision. There are no routine backups, new checkouts, pointer switches, or automatic rollback. Build failures stop before the PM2 restart; pulled source and dependency changes remain on disk. Review and take backups explicitly before risky data migrations. Existing backups and previous checkouts are retained.

`deploy-all.sh` requires explicit client names and updates them sequentially, stopping on the first failure. It does not discover and update the entire fleet automatically.

## Installation layout

```text
~/vito-source/
  run-current.sh             stable PM2 launcher
  current -> checkouts/<checkout>
  checkouts/<checkout>/      editable source, dependencies and web build
    user -> <existing persistent user directory>
  data/user/                 default for new installations
```

`spinup.sh` prepares this layout for a new instance. Existing clients require individual inspected migrations; `deploy.sh` refuses to migrate a different installation automatically. Retain any existing data location and symlink it into the checkout. Do not move credentials or replace deployment settings from another machine. Do not overwrite old source edits.

The stable launcher is installed from `scripts/run-source-current.sh`. PM2 runs `<root>/run-current.sh` with bash and `<root>` as cwd, under the existing service owner and PM2_HOME. It resolves `current` and executes that checkout's `scripts/run-source.sh`, which runs TypeScript through tsx. Updates retain the Vito entry's environment and options and never reload other PM2 apps.

## Runtime paths and conversations

| Variable               | Purpose                                           |
| ---------------------- | ------------------------------------------------- |
| `VITO_PI_AGENT_DIR`    | Pi configuration directory and provider auth.json |
| `VITO_LOGS_DIR`        | Trace and service logs                            |
| `VITO_ATTACHMENTS_DIR` | Attachments                                       |
| `VITO_SOURCE_REVISION` | Full commit captured by the launcher at startup   |

Set the first three to canonical paths in persistent client storage during provisioning. The checkout launcher defaults them beneath `user/`. Explicit context overrides take precedence; source installs without the launcher keep their existing path defaults.

Pi sessions resume from the latest validated file scoped to the same Vito session, even when the source checkout's path changes. `/new` still starts a fresh conversation. Deployments do not rewrite transcript cwd headers.

Health reports the source revision at startup. Check Git status separately for edits to mutable source; the revision does not prove that a checkout remains unchanged.

## Preparation and recovery limits

Merge the source deployment changes into `main` before using the update command. The deployer fetches Git on the client; private-repository access must already work there. It never copies operator Git or cloud credentials. The deployer accepts Node 22.19+ or Node 24; review other majors separately. routine updates do not install Node, OS packages, browser libraries, or change privilege boundaries.

Review startup database/config transformations before approving each update. Take explicit backups and rehearse risky migrations on disposable or isolated copy data with integrations disabled. Routine updates do not back up or restore user data.

During initial migrations, preserve required environment and process options, take a fresh consistent backup, switch only Vito, and verify enabled channels and unrelated apps. Keep the former installation available until reviewed cleanup is approved.

Interrupted or failed updates require operator recovery. A typical source build may take minutes while the existing process continues serving; the final PM2 restart causes the service interruption.

Builds default to a 1536 MB Node heap cap; `VITO_BUILD_NODE_OPTIONS` on the target can override it when `NODE_OPTIONS` is unset. Verify available RAM and swap before updating small instances. A lower cap can fail backend type compilation; build failures leave the running service unchanged.
