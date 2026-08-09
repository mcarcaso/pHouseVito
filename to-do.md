# Vito follow-up work

## Move app publication behind a constrained Caddy gateway

Preserve the current in-process app proxy for backward compatibility until this migration is designed, implemented, and tested separately.

Planned direction:

- Keep `apps.baseDomain` for app URL construction.
- Add stable agent-facing commands such as:
  - `vito apps publish <name>`
  - `vito apps unpublish <name>`
  - `vito apps status <name>`
- Have the apps skill call the Vito CLI rather than edit Caddy or use HTTP/curl.
- Put privileged Caddy changes behind a root-owned helper or Unix-socket service that the agent cannot modify.
- Accept only validated semantic inputs such as app name and visibility; never accept raw Caddy directives, arbitrary hostnames, ports, or file paths.
- Derive the hostname from the validated app name and configured base domain.
- Resolve and verify the upstream port against the app's managed PM2 process.
- Generate routes from a fixed template, write atomically, run `caddy validate`, reload gracefully, and roll back on failure.
- Design private/public app access explicitly. Private apps should use a generic authentication gate; public apps should intentionally bypass it.
- Strip sensitive request and response headers before forwarding where appropriate.
- Preserve existing public app behavior during migration unless a separate compatibility decision is made.
- Add end-to-end tests for publish, unpublish, failed validation, rollback, stale routes, port reuse, and Caddy reload failure.
