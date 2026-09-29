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
