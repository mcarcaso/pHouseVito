---
name: vito-config
description: Validate Vito configuration changes and diagnose schema errors. Use whenever editing user/vito.config.json or troubleshooting configuration reloads.
---

# Vito Config

Vito's config remains directly editable with normal filesystem tools. Validate it after every edit before considering the change complete.

## Validate the active config

```bash
npm run validate:config
```

## Validate another config file

```bash
npm run validate:config -- path/to/vito.config.json
```

A valid config exits with status 0. Invalid JSON or schema violations exit with status 1 and print each issue with its exact config path.

If validation fails, fix the file and run the validator again. Do not restart Vito with an invalid config. While Vito is already running, it ignores invalid updates and continues using its last known valid config.
