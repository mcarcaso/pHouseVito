# Source deployments with persistent user data

Run Vito from an editable Git checkout with development dependencies installed. Keep customer state outside the checkout so preparing a new source revision does not replace databases, credentials, Pi sessions, apps, or Drive files.

## Preparing a checkout

Inspect the current installation, service owner, PM2_HOME, process configuration, and local Git changes first. Preserve existing changes and deployment credentials. Prepare a separate checkout at the reviewed full revision rather than pulling over a live tree or resetting local edits.

As the service owner, install backend and mobile dependencies with `npm ci --include=dev` and `npm --prefix mobile ci --include=dev`. Run `npm run check` and `npm run build`. Export the companion web into the new inactive checkout or a temporary staging directory. Never export over the running client's web directory during preparation.

The prepared checkout's `user` symlink should resolve to the existing persistent user directory. Create it only when no user directory or link already exists; do not overwrite customer state. Smoke tests must use fake or appropriately isolated copy data with integrations disabled.

## Source launcher and runtime paths

Configure only the Vito PM2 entry to run `scripts/run-source.sh` with bash and the checkout as its cwd. Preserve the existing owner, PM2_HOME, required environment, and process options. Do not apply a complete example ecosystem configuration over unrelated running apps.

The launcher executes `src/index.ts` through tsx, clears `VITO_RELEASE_MODE`, and defaults these paths beneath the persistent user directory:

| Environment variable | Purpose                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| VITO_PI_AGENT_DIR    | Pi configuration directory; also selects the provider service's auth.json |
| VITO_LOGS_DIR        | Trace and service log directory                                           |
| VITO_ATTACHMENTS_DIR | Attachment directory                                                      |
| VITO_SOURCE_REVISION | Full Git revision captured when the launcher starts                       |

Explicit context path overrides still take precedence. Existing source installs that do not use this launcher retain their default paths. This prevents a migration from silently switching Pi authentication back to a separate file under the service user's home directory.

Health responses include the launcher's full source revision. It identifies the commit at startup; use Git status separately to inspect local edits. An already running process does not change its reported startup revision when someone fetches or edits its checkout.

## Cutover and rollback

Before an approved cutover, save the Vito process configuration privately and take reviewed consistent snapshots of affected persistent state. SQLite snapshots must include WAL changes through the backup API. Stop and replace only Vito's process entry, start the prepared checkout, and verify its process cwd, revision-bearing local and public health responses, database integrity, config validity, enabled channels, and unrelated application status.

Keep the prior installation available. If verification fails, stop only Vito and restore its previous process configuration and code target. Do not automatically restore user snapshots or discard new messages. Data compatibility requires review independently of whether the code is distributed as source or a release bundle.

## Subsequent updates

Review local source edits and the target revision before updating. Reconcile agent changes deliberately; never use a blind reset or overwrite deployment configuration from another machine. Prepare dependencies, checks, and web assets before restarting. Use an approved cutover and verify the running revision afterward. A staged source checkout can provide a code rollback without requiring signed binary installers.

The existing `aws_deploy/deploy-source.sh` remains a legacy in-place path: it pulls, installs, builds, and restarts without these preparation and health gates. Do not use it unchanged for a managed-to-source migration.
