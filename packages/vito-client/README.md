# @vito/client

Headless React client runtime shared by the Vite dashboard and Expo companion.

Owns TanStack Query providers, transport/authentication context, validated API boundaries, query keys, hooks, mutations, polling, and cache invalidation. It does not contain DOM or React Native UI.

Platform clients provide `VitoClientOptions`:

- Dashboard: same-origin cookie transport.
- Expo: configured base URL plus Secure Store-backed bearer token storage.

Shared modules currently cover authentication, sessions, paginated chat history, chat polling, aliases, sending, and archival. New client data access belongs here rather than in either presentation application.
