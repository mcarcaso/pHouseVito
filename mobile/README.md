# pHouseVitoReactNative

Expo companion app for connecting to a personally named Vito agent on native and web. The installed product name is **Vito**; `phouse-vito-react-native` is the internal project/package name.

## Run

```bash
npm install
npm run web
npm run ios
```

The app defaults to `https://theworstproductions.com`. Override the server for development:

```bash
EXPO_PUBLIC_VITO_URL=http://localhost:3030 npm run web
```

For a physical phone, use a URL the phone can reach (the production HTTPS endpoint is preferred).

## Local iOS builds

Development and preview IPAs are compiled locally with Xcode, signed, verified, and published to the Vito installer website:

```bash
npm run build:ios:local
npm run build:ios:development:local
npm run build:ios:preview:local
```

Installer: https://theworstproductions.com/d/builds/vito/

For the development client, start Metro in tunnel mode and enter the generated
`https://<subdomain>.exp.direct` URL manually in the app. iOS rejects the tunnel when
entered as plain HTTP.

## Direction

The existing Vite dashboard remains authoritative while capabilities migrate incrementally. The intended destination is full Expo parity across iOS, Android, and web, followed by retirement of the Vite client.
