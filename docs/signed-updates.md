# Signed managed-release updates (feature branch)

## What this implements

One signed release feed, a check/download/reverify path, a detached PM2 cutover worker, and authenticated dashboard controls. Owner Discord text commands and the dashboard use the same apply function. The worker stops only `vito-server`, atomically replaces `current`, starts through a stable launcher, checks `/api/health` for the **expected Git revision**, and switches back if the new release is unhealthy. Status is persisted outside the release and visible after restart. Source checkouts cannot apply binary updates.

This is not a security sandbox: the provisioned service user needs installation write permission. Root-owned or privilege-separated deployments need an operator-controlled supervisor before this workflow can be enabled. Do not grant blanket passwordless sudo to an agent.

## Signed data-impact policy

New manifests use schema 2, a monotonic positive `sequence`, and a mandatory `dataImpact`:

- `{"kind":"none"}`: no intentional transformations of persistent user state, including during startup. No fresh backup is taken; the old release remains available for binary rollback.
- `{"kind":"compatible-migration","files":["vito.db","vito.config.json"],"notes":"Reviewed migration description","backwardCompatible":true}`: requires explicit migration approval. Stop the service before taking targeted private snapshots. SQLite uses its backup API (WAL-safe) and checks backup integrity. Old code must operate correctly against the migrated data. Binary rollback does **not** restore snapshots or discard new messages.
- `{"kind":"breaking","notes":"Describe data changes and recovery plan"}`: self-service apply is blocked. An operator must arrange backup, downtime, and recovery. Do not offer a misleading binary-only rollback for an irreversible migration.

Review these declarations against migrations, config normalization, startup writes, and integration side effects. The signature authenticates the publisher's classification; it cannot prove the code obeys it. Unknown/schema-1 manifests can be checked/staged but never self-applied. Publisher sequences must increase; a local successful-update receipt rejects earlier sequences. Initial/bootstrap installs still require operator review of their starting revision/sequence. This is not absolute anti-rollback against an administrator changing local receipts.

## Provisioning existing binary installations (owner only)

First install a trusted release containing this updater **and revision-bearing health responses** through the existing operator deployment path. Securely back up the pinned Ed25519 signing key before distributing self-service releases.

Then, as the installation/service owner:

```sh
bash scripts/provision-update-service.sh /opt/vito-managed 3030
```

This only creates `run-current.sh` and `update-service.json`; it does not change PM2 or restart anything. Explicitly reconfigure the one PM2 Vito entry to execute `/opt/vito-managed/run-current.sh` using bash, with the correct owner, environment and PM2_HOME, verify health, and save the PM2 configuration. Leave all unrelated apps alone. The worker rejects a PM2 entry pinned to an old release path. Check installation write permission first; the AWS operator installer currently uses sudo, so provisioning must resolve ownership/supervisor policy deliberately rather than silently assuming it is writable.

## User/agent flow

A model may help explain an update and its signed impact, but owner approval must be explicit. The model must not restart itself or silently initiate cutover.

```sh
./vito update status
./vito update check
./vito update stage
./vito update apply VERSION FULL_REVISION --approve
# Only when signed policy declares a compatible migration:
./vito update apply VERSION FULL_REVISION --approve --approve-migration
```

Apply refers to **already staged** verified bytes. It re-verifies manifest and installer before queuing and again in the worker, and checks the requested revision to reject a changed release. Downloads are fixed to the pinned GitHub repository and bounded in size. No arbitrary installer URL, shell command, service name, remote health target, or unsigned fallback is accepted.

Owner Discord text commands use `/update status`, `/update check`, `/update stage`, and `/update apply VERSION FULL_REVISION --approve [--approve-migration]`. The apply command itself is the explicit confirmation. Other chat/intake/API channels cannot apply via this deterministic handler. Natural-language requests should lead to a reviewed plan and that confirmation command, not an autonomous restart.

Dashboard: Server → Signed binary updates → Check → Download and verify → Update Vito. The final confirmation shows the data-impact policy/targeted backup list. Routes require dashboard authentication and validated explicit approval. Requests return before the detached supervisor stops the server. UI polls persisted status and tolerates restart disconnects. Breaking updates direct the owner to an operator-led recovery plan.

## Operation and recovery

`data/update-status.json` records queued/installing/stopping/backing-up/starting/succeeded/rolled-back/failed-before-activation/recovery-required. `data/update.log` and `data/update-error.txt` stay private to the installation. An exclusive `data/update-lock` prevents concurrent applies. A process crash may leave the lock: an operator must inspect status, logs, current release and actual process before clearing it. A failed rollback retains the lock. Backups are private under `data/update-backups/SEQUENCE-VERSION/`; old releases and backups are **not automatically deleted**. Define retention after real installation sizes and recovery needs are understood.

A supervisor crash or host reboot mid-cutover is not yet automatically reconciled. Health checks establish local HTTP readiness/revision, not end-to-end channel delivery or model quality. If new code makes externally visible changes before a failed health check, binary rollback cannot undo them. Only classify a migration compatible after testing both new and old code against the migrated data.

## Publishing

Build clean matching-architecture installers from one full Git revision. Never include user data or credentials. Build the signing helper's schema first (`npm run build`), then supply a reviewed policy JSON such as:

```json
{ "sequence": 2026093001, "dataImpact": { "kind": "none" } }
```

```sh
node scripts/sign-update-manifest.mjs VERSION FULL_REVISION /secure/private-key.pem policy.json INSTALLER...
```

Publish the installers, `update-manifest.json`, and `update-manifest.sig` together. The helper currently uses the host Node major for all supplied assets; do not combine incompatible Node majors. GitHub `latest` must be the intended production release. The optional `VITO_UPDATE_TEST_TAG=updater-test-N` stays restricted to signed test tags on the same repository and never changes production latest. Staging currently reads installers into memory (up to 1 GiB); streaming remains future work.

## Verification completed / still required

- Prior September 29 disposable Linux x64 drill: real standalone installer, signed download/staging, tamper rejection, manual activation/health/rollback with fake data. Test VM/firewall and public prerelease were removed.
- This iteration: cutover ordering/failure injection and route auth/approval tests. A repeatable **local fixture** uses an isolated PM2_HOME, generated throwaway signing key, fake installers/services, and fake data. It tests successful activation, failed-new-release rollback, a WAL-backed targeted SQLite snapshot, and successful/failed cutover launched from inside the managed PM2 service (dashboard-origin process-tree regression). It never accesses production services. Run after building with globally available PM2:

```sh
npm run build
node test/fixtures/update-supervisor-drill.mjs
```

- September 30 disposable Hetzner Ubuntu 24.04 x64 / Node 24.13 / PM2 7.0.4 drill: clean real binary installers passed CLI cutover/expected health, tamper rejection, migration approval and a WAL-backed private targeted snapshot. A real authenticated dashboard request exposed PM2 killing the detached child worker with its parent service tree. The initial operation stopped before activation and retained its recovery lock; after inspection, operator recovery on the disposable VM restored the old service. Commit `e9c3250` added a double-fork trampoline. A newly built real installer then passed authenticated-dashboard-triggered automatic rollback from a deliberately broken startup release and returned the exact previous revision healthy, retaining fake data. Test-only good/broken commits existed only on the VM; no production credentials/private signing key were copied. Installers and locally signed metadata were pre-staged over SSH, so this iteration did not retest GitHub feed/download. The VM and its SSH-only firewall were deleted and deletion verified. Private evidence lives in `user/drive/private/ops/hetzner-updater-drill-20260930/` on the operator Mac.

The fixture is not production upgrade proof. Before merge/distribution, finish owner chat confirmation/progress end-to-end, review supervisor/ownership provisioning, and securely back up the signing key. Test other architectures separately. Crash/reboot reconciliation remains operator-led. No production cutover is authorized by these development checks.

### October 1 isolated browser QA

The exported companion web was served only on loopback; all API responses were fixtures, external requests/WebSockets were blocked, and no actual update/restart was invoked. Chromium tests and screenshot review passed at 1440/light, 1920/dark, 390/light, 320/light and 320/dark. The updater card now shares the Server page's content width, visible themed buttons, and spacing. Cancellation sends no apply; confirmation includes the full **actually staged** revision and signed backup policy even if the feed changes between check and download. Stage now returns a reverified `stagedPlan`; stale/no-download results cannot enable Apply. Active updates and recovery-required states disable controls, interrupted polling recovers, and terminal status clears stale queued messaging. Breaking policies and checksum failures cannot enable Apply. Source installs explain why binary apply is unavailable and preserve source rebuild controls.

Repeat after exporting web assets to a non-live staging directory:

```sh
node test/fixtures/update-dashboard-browser.mjs /absolute/staged-web /absolute/private-screenshot-dir
```

This exercises browser behavior with mocked endpoints, not native iOS/Safari or a real browser-to-signed-feed cutover. Those distinctions remain important. The real authenticated backend/supervisor rollback was independently tested on Hetzner. Private screenshots/results are under `user/drive/private/ops/updater-dashboard-qa/` on the operator Mac.
