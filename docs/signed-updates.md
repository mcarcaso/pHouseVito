# Signed binary updates (experimental)

This branch adds `vito update check` and `vito update stage`. They do **not** install,
activate, restart, or roll back a release. The existing offline installer and
`manage-release.sh` remain the operator-controlled cutover mechanism. No release
has been published by this work.

## Trust and signing

The CLI embeds an Ed25519 public key. The matching private key was generated
locally under the maintainer's `user/release-signing/` with mode 0600; it is **not**
in the repository or release bundle. Back it up securely before relying on
self-service updates. Losing it means clients need a trusted manual update to
replace their pinned public key. Never store it in a GitHub Action or commit it.

Build installers on the target OS/architecture and supported Node major, using
`scripts/build-release.sh` and `scripts/build-installer.mjs` (requires pinned
`POSTJECT_BIN`). Review the archive and verify there are no credentials or user
files. Give installers names like `vito-installer-v1-darwin-arm64` and use GitHub
release tag `v1`. The manifest's `revision` must be the full SHA-1 Git revision
embedded in every release; do not combine installers built from different commits
or incompatible Node majors in one manifest. The signing helper currently uses
the host Node major for all supplied assets, so sign assets for different Node
majors in separate releases.

From a staging directory containing the installers:

```sh
node /path/to/repo/scripts/sign-update-manifest.mjs v1 FULL_GIT_REVISION \
  /secure/path/update-ed25519-private.pem vito-installer-v1-darwin-arm64 ...
```

Publish each installer plus `update-manifest.json` and `update-manifest.sig`
to the same public release. `vito update check` downloads the manifest and
verifies its exact bytes against the embedded key. `vito update stage` also
verifies the selected platform installer by signed size and SHA-256 before
placing it under `~/.vito/updates/VERSION/`. Both require HTTPS and enforce
bounded downloads and allowed hosts. No unsigned fallback is available.

The CLI currently does **not** enforce monotonic versions or automatically
apply releases. An owner should review the release and use the existing
installer/manager commands to activate and health-check it, with rollback
available. Do not market this as automatic or one-click updating.

## Important limitations

- GitHub's `latest` release must be the intended update; pinned signatures
  prevent forged manifests but not replay of an older legitimately signed one.
- Check/stage has not been tested against a published release or all supported
  installer architectures.
- The updater reads installer content into memory (up to 1 GiB); switch to
  streaming verification before shipping large public artifacts.
- This branch is isolated from the running source checkout. Deploying it to
  existing binary users requires one trusted manual release first.

## Test release channel

For a non-production test, publish a **prerelease** tagged `updater-test-N`
on the same repository and set `VITO_UPDATE_TEST_TAG=updater-test-N` when
calling `vito update check` or `stage`. The CLI restricts this override to
test-tag names under the pinned GitHub repository and still requires the
same signature. GitHub prereleases do not replace `latest` for normal clients.
Do not distribute the test tag to friends.

## Disposable Linux x64 drill, September 29, 2026

On a Hetzner Ubuntu 24.04 cpx21 VM with Node 24.13.0, built clean
`baseline-469ed78` and `updater-test-20260929` installers from real source
revisions. The new release embedded revision
`457f2cac491c98e0a5b3f0d3407addb8c11ab0a7` and `Dirty: 0`.
The release archive contained no mutable `user/` folder or signing key;
`user.example/secrets.json` had only empty sample values. No production
credentials were installed on the VM.

Installed/activated the baseline from its standalone SEA installer, created
one fake data marker, and validated its config. Published a temporary signed
GitHub prerelease `updater-test-20260929` containing the new Linux x64
installer. Ran the updater's `check` and `stage` with `VITO_UPDATE_TEST_TAG`:
the verified 323030208-byte downloaded file matched the source SHA-256
`8699dc412a5f3eb191b097b7a92f4ffa5e082517c928ac424cc19670fc663bf9`.
Flipping one byte was rejected by asset verification. Installed and activated
the staged installer, validated config and `/api/health`, then rolled back and
verified `/api/health` again; fake data survived both switches. Neither stage
nor activate restarted a service. The test prerelease and VM were removed
after the drill.

This proves only Linux x64 on the tested Node ABI. It does not prove production
service-manager cutover, live chat tokens, other architectures, automatic
rollback, key recovery, or downgrade protection. Continue to require human
operator approval for installation and service restart.
