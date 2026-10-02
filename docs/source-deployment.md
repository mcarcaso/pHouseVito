# Deploying Vito from source

Vito runs from an editable Git checkout with backend and mobile development dependencies installed. Client state lives outside the checkout. Agents can work on source, while the owner controls deployment and restart.

## Update one client

After approving that client's update and downtime:

```bash
./aws_deploy/deploy.sh mar
```

The command reads that client's local `aws_deploy/state/<name>.json`, uses the existing SSH key (`~/.ssh/vito-deploy.pem`, or `VITO_SSH_KEY`), and requires a trusted known-host entry. It sends no operator deployment credentials to the client.

On the host it discovers the existing Vito PM2 installation and:

1. Checks that the online service runs the prepared source launcher, its current checkout is clean, and its origin is the expected repository.
2. Fetches latest `origin/main` and prepares a new editable checkout on `main`. If that revision is already running, it exits without restarting.
3. Installs backend and mobile dependencies, builds backend and companion web in that inactive checkout, and validates the client's existing config from the checkout directory.
4. Stops only `vito-server`, takes consistent SQLite snapshots plus config, secrets, profiles, Pi sessions and authentication, and atomically switches the source pointer.
5. Restarts Vito with its existing PM2 configuration. Checks exact local/public health revision, channel startup readiness, database integrity, config validity, process cwd, and unchanged unrelated PM2 apps; then saves PM2.

A preparation failure leaves the current process running. A failed cutover restores the prior code pointer and restarts Vito. It never automatically restores live user data. Private deployment logs, backups and results live in `~/vito-backups/source-deploys/`. Failed candidate checkouts and prior checkouts are retained for inspection; there is no automatic pruning.

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

Review startup database/config transformations before approving each update. Source distribution does not make a destructive migration safe. Snapshots are a recovery resource; code rollback cannot undo incompatible data transformations. Rehearse risky revisions on disposable or isolated copy data with integrations disabled.

During initial migrations, preserve required environment and process options, take a fresh consistent backup, switch only Vito, and verify enabled channels and unrelated apps. Keep the former installation available until reviewed cleanup is approved.

Worker or host crashes during a stopped cutover require operator recovery. There is no automatic reboot reconciliation. Keep backups and prior checkouts private and review retention manually. A typical source build may take minutes while the existing process continues serving; only the final stop/snapshot/switch/restart needs downtime.
