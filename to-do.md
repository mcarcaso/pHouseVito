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

## Reject tool results containing raw secrets

Add a fast secret-scrubbing guard at the tool-result boundary before tool output is added to agent context, persisted, traced, or relayed.

Planned direction:

- Resolve the current set of non-empty secret values through `SecretService` without exposing them to the agent.
- Check every tool result for exact plaintext occurrences of those values.
- Ignore values too short to match safely, with a documented minimum length to avoid broad false positives.
- If any secret matches, reject the entire tool result rather than attempting partial redaction.
- Return a generic blocked-result message to the agent that does not include the secret, matched value, or sensitive surrounding content.
- Never write the rejected result or matched secret to normal logs, traces, messages, or error output; security telemetry may identify only safe metadata such as the secret key name and tool name.
- Define behavior for structured, binary, oversized, and streaming tool results before implementation.
- Treat encoded, fragmented, or transformed secrets as a separate follow-up; the initial guard is an inexpensive exact-plaintext defense.
- Add tests proving clean results pass through, raw secrets are blocked, multiple secrets are handled, short/empty values are ignored, and blocked content never reaches persistence or tracing.
