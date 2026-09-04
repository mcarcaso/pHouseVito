---
name: vito-native-builds
description: Build Vito iOS development and preview IPAs locally on Mike's Mac, verify signing, and publish wireless installers to the Vito build website without using EAS cloud compilation
---

# Vito Native Builds

Use this skill whenever Mike asks for a native Vito build, local iOS build, development build, preview build, IPA, or an update to the iPhone installer website.

## Policy

- Compile on Mike's Mac with Xcode via `eas build --local`; never submit an EAS cloud build unless Mike explicitly asks for cloud compilation.
- EAS CLI may retrieve the existing project credentials, but compilation and packaging happen locally.
- Build only iOS unless Mike explicitly requests Android.
- **Never default to building every channel.** If Mike does not specify a channel, ask whether he wants `development`, `preview`, or `all` before running a build.
- Treat `all` as an explicit choice, not a fallback.
- Publish successful builds to the public Drive installer site.
- Never restart `vito-server`.
- Local build commands can take more than five minutes; always use a generous timeout.

## Commands

A target is mandatory. From the Vito repository root:

```bash
node user/skills/vito-native-builds/build-and-publish.mjs development
node user/skills/vito-native-builds/build-and-publish.mjs preview
node user/skills/vito-native-builds/build-and-publish.mjs all
```

Running the script without a target intentionally fails rather than silently building both channels.

The command:

1. Verifies Xcode, CocoaPods, app configuration, and TypeScript.
2. Increments `expo.ios.buildNumber` for every IPA.
3. Runs the selected EAS profile with `--local`.
4. Verifies the IPA bundle identifier, version, and embedded provisioning profile.
5. Compares every Expo-registered iOS device against the embedded profile and refuses to publish when any registered device is missing.
6. Stores versioned local artifacts under `mobile/builds/`.
7. Publishes the latest IPA, manifest, icon, metadata, and installer pages under `user/drive/builds/vito*`.
8. Keeps the old `/d/builds/rook/` URL as a redirect to the canonical Vito installer.

## Installer

Canonical selector:

https://theworstproductions.com/d/builds/vito/

Profile pages:

- https://theworstproductions.com/d/builds/vito-development/
- https://theworstproductions.com/d/builds/vito-preview/

Open the page in Safari on Mike's registered iPhone and tap Install.

## Reporting

Report:

- whether compilation was local
- profile and build number for each successful build
- canonical installer URL
- any verification failure

Do not describe a queued cloud build as complete. A build is complete only after the local IPA exists, verification passes, and the public manifest/IPA return HTTP 200.
