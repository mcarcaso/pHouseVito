---
name: vito-config
description: Validate Vito configuration changes and diagnose schema errors. Use whenever editing user/vito.config.json or troubleshooting configuration reloads.
---

# Vito Config

Vito's config remains directly editable with normal filesystem tools. Validate it after every edit before considering the change complete.

## Validate the active config

```bash
./vito config validate
```

## Validate another config file

```bash
./vito config validate path/to/vito.config.json
```

A valid config exits with status 0. Invalid JSON or schema violations exit with status 1 and print each issue with its exact config path.

If validation fails, fix the file and run the validator again. Do not restart Vito with an invalid config. While Vito is already running, it ignores invalid updates and continues using its last known valid config.

## Settings and credentials

Global settings live in `settings`, channel overrides in `channels.<name>.settings`, and session overrides in `sessions.<session-id>`. Preserve unrelated settings. Chat models are configured in `settings.pi-coding-agent.model`; memory contextualization and fact extraction can have separate models under `settings.memory`.

Credentials are separate: API keys and channel tokens live in `user/secrets.json`; OAuth uses `$VITO_PI_AGENT_DIR/auth.json` when set, otherwise `~/.pi/agent/auth.json`. Prepared source deployments normally use persistent `user/pi-agent/auth.json`. Do not copy auth between installations or print its values. Removing a provider credential does not automatically change configured models.

Structured job schedules have their own timezone, independent of `settings.timezone`. Read the scheduler skill for job definitions. Config changes hot-reload; changes to the cached prompt require `/new` in the affected conversation.
