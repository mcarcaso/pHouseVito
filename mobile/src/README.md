# Mobile source structure

- `application/` — application shell, navigation composition, route types, linking, and shell styles. Named `application` rather than `app` because Expo treats `src/app` as an Expo Router root.
- `screens/` — route-level feature composition. Each feature owns its screens and local styles/components.
- `components/` — presentation components shared by multiple features.
- `hooks/` — mobile-specific React hooks. Shared server/domain hooks belong in `@vito/client`.
- `contexts/` — React context definitions and state contracts.
- `providers/` — provider lifecycle/composition (`AppProviders`, theme, Vito client).
- `services/` — non-React infrastructure such as API/auth/storage and native/web voice transports.

Keep feature-specific types, hooks, and components beside their owning screen. Promote them to the shared directories only after a second feature needs them. Screens compose behavior; they should not become API clients or generic object renderers.
