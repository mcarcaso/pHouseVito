# Vito Mobile

Expo foundation for the eventual shared native/web Vito dashboard.

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

## Direction

The existing Vite dashboard remains authoritative while capabilities migrate incrementally. The intended destination is full Expo parity across iOS, Android, and web, followed by retirement of the Vite client.
