---
name: vito-config
description: Configure how Vito responds, remembers background chatter, and controls who can invoke it; explain participation presets, settings scopes, models, defaults, hot reload, and validate config edits.
---

# Vito Settings and Config

Use this skill when asked to change or explain Vito settings, including “require mentions”, “listen without replying”, “remember this group”, or speaker permissions. This is core platform documentation; client-specific overrides belong in user/skills/.

## Safe workflow

1. Read `user/vito.config.json` from the running checkout. Never print secrets.
2. Identify the requested scope. “This chat” means the exact current session ID, not the entire channel.
3. Explain ambiguous participation choices before changing them. Preserve unrelated values.
4. Edit the config directly, then run `npm run validate:config` (or `./vito config validate`). Fix any validation errors.
5. Report the changed scope and behavior. Do not restart Vito.

Config is watched with a roughly three-second debounce. Invalid updates are ignored in favor of the last valid config. Documentation does not prove the running process contains newly pulled code: code changes need an owner-controlled build/restart.

## Where settings live

Precedence: built-in defaults → `settings` → `channels.<channel>.settings` → `sessions.<session-id>`.

Session entries ARE settings objects; do not add another `settings` wrapper there. Example:

```json
{
  "sessions": {
    "telegram:-1004300925215": {
      "requireMention": true,
      "passiveMemory": false
    }
  }
}
```

Merge this into the existing config; do not replace the file with the example. Channel example: `channels.telegram.settings.requireMention`. Global example: `settings.requireMention`.

Scalars and user-ID arrays replace inherited values. Runtime-model and memory objects merge one level deep; their nested model objects replace rather than recursively merge. To inherit again, delete the direct-file override. `null` is supported as a reset in settings PATCH APIs, not as a stored settings value.

## Participation: two independent switches, three presets

| Preset                     | requireMention | passiveMemory |
| -------------------------- | -------------- | ------------- |
| Always participate         | false          | false         |
| Listen, respond on mention | true           | true          |
| Mention only               | true           | false         |

The dashboard presets set BOTH switches as above. The switches can also be edited separately; `false/true` is valid but passive capture generally matters only for messages that do not invoke the agent.

- `requireMention`: response trigger, not permission to remember. If omitted everywhere, invocation gating treats it as true.
- `passiveMemory`: capture eligible silent chatter without an agent turn. Defaults to false.
- Normal permitted invocation requests and assistant replies still enter ordinary conversation history, even when passiveMemory is false or their speaker is excluded from background capture.

Do not describe passiveMemory as live conversation ingestion or continuous compaction. Silent messages enter SQLite and the batched memory pipeline (semantic chunks and fact extraction), but do NOT individually enter the live Pi transcript, trigger an agent response, or trigger Pi compaction. Processing is asynchronous, not guaranteed immediate.

On a later invocation, a small permitted background window can be supplied as quoted context. Earlier captured messages are available through `conversation_background_history`, scoped to this conversation and rechecked against current speaker permissions. Counts describe locally captured messages, not complete platform history. Turning capture off does not delete already stored messages or memories.

## Who can invoke versus whose chatter is remembered

These are independent settings at any scope:

| Setting           | Values                                       | Meaning/default                                                                                                |
| ----------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `invokeUserIds`   | `"everyone"`, `"nobody"`, or string ID array | Who can invoke/control Vito. If absent, falls back to a nonempty channel `allowedUserIds`, otherwise everyone. |
| `rememberUserIds` | same                                         | Whose silent chatter is captured; absent means everyone, but only when passiveMemory is true.                  |

Use platform user IDs, not display names or @usernames. An empty array allows nobody. Missing identity fails closed for ID lists. Background capture also requires author ID and platform message ID; bot messages are excluded. Passive attachments store metadata only, without downloading the files.

A speaker denied invocation can still have eligible chatter captured if passive capture permits them. A speaker allowed invocation can still have silent chatter excluded. Remember permissions do not disable storage of ordinary invocation requests. Authorized control commands can bypass mention gating; mention-required is not a blanket ban on slash commands. Platform/chat allowlists and transport visibility remain separate gates.

Example: this Telegram group listens to everyone, but only a selected user can invoke it:

```json
{
  "requireMention": true,
  "passiveMemory": true,
  "rememberUserIds": "everyone",
  "invokeUserIds": ["ACTUAL_TELEGRAM_USER_ID"]
}
```

Place that object at the desired settings scope; replace the placeholder with a verified ID. Never guess IDs.

## Platform caveats

Passive capture is implemented for Telegram, Discord, and Slack. Do not assume identical behavior for other channels.

Telegram private chats count as addressed automatically. In groups, the current text handler recognizes the bot's actual @Telegram username, case-insensitively. Plain “Vito” or replying to a bot message is not the same as that text mention. Telegram bot privacy mode/access can prevent ordinary group chatter from reaching Vito; settings cannot remember unseen messages. Discord/Slack likewise need appropriate platform access/intents. Offline and pre-capture gaps are possible; passive mode is not an automatic historical backfill.

## Other supported settings

All are scoped through the same cascade unless noted:

- `customInstructions`: additional prompt instructions. Cached prompt changes require `/new` in the affected chat.
- `traceMessageUpdates`: boolean, default false; diagnostic message tracing, not a response/remember switch.
- `timezone`: IANA timezone. Runtime startup fallback is `America/Toronto`; structured jobs have their OWN timezone. Read scheduler before changing jobs. Do not assume changing this field resets process-wide TZ immediately.
- `pi-coding-agent.model`: `{ "provider": "...", "name": "..." }`. Verify supported models instead of guessing a default. `openRouterProvider` optionally selects routing; `thinkingLevel` is `off`, `low`, `medium`, or `high`. Live model/runtime settings reconcile on reload/subsequent turns.
- `memory.chunkContextualizerModel` and `memory.factExtractorModel`: separate provider/name selections for memory processing; changing the chat model does not change these.
- `memory.factIngestionMode`: `one-shot` or `persistent-pi`.

Credentials are NOT settings: manage `user/secrets.json` through SecretService/dashboard. Provider OAuth uses `$VITO_PI_AGENT_DIR/auth.json`, otherwise `~/.pi/agent/auth.json`; prepared deployments normally use persistent `user/pi-agent/auth.json`. Never copy auth files or print credential values. Removing provider access does not update any model selection automatically.

Jobs, app domains, channel connection configuration, and bot identity are other config sections, not arbitrary settings keys. Use their dedicated skills and schema.

## Channel access / whitelists (not cascading settings)

These fields live directly under `channels.<name>`, alongside `enabled` and `settings`. They do NOT belong under `settings` or a session entry.

| Field                 | Platform/use                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`             | Required channel boolean; connection lifecycle may require restart—verify channel implementation before promising immediate activation.                        |
| `allowedChatIds`      | Telegram chat IDs; empty/absent allows all chats. Numbers normalize to strings; prefer strings, including negative group IDs.                                  |
| `allowedGuildIds`     | Discord server IDs; nonempty list restricts guild messages/interactions.                                                                                       |
| `allowedWorkspaceIds` | Slack workspace/team IDs; nonempty list restricts workspaces.                                                                                                  |
| `allowedChannelIds`   | Discord/Slack channel IDs; nonempty list restricts non-DM locations.                                                                                           |
| `allowedUserIds`      | Legacy user allowlist; also supplies the invocation fallback when `invokeUserIds` is absent. Some platform control/interaction paths check this separately.    |
| `allowDms`            | Discord/Slack DM gate; current implementations allow DMs by default. DM paths bypass guild/non-DM channel filters, but not necessarily other checks.           |
| `ownerIds`            | Platform owner/control privileges, not permission to capture chatter. Slack requires an explicit configured owner; Discord also recognizes application owners. |

Do not treat these gates as interchangeable. Explicit `invokeUserIds` overrides its legacy fallback, but cannot guarantee bypassing a separately checked platform interaction allowlist. Prefer the new cascading invocation settings for normal conversational permissions. Check the actual adapter for control-command behavior.

Example location gate plus separate participation rules:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "allowedChatIds": ["-1004300925215"],
      "settings": {
        "requireMention": true,
        "passiveMemory": true,
        "invokeUserIds": ["ACTUAL_USER_ID"],
        "rememberUserIds": "everyone"
      }
    }
  }
}
```

This is a merge example, not a replacement config. Enabling everyone is an access/privacy decision: never widen an existing whitelist silently.

## Custom system instructions and overrides

`customInstructions` is the supported user-configurable prompt field. It is included as a custom-instructions block in the system prompt; it is not a replacement for core policy, SOUL, or the entire system prompt.

A session string REPLACES the inherited channel/global string; strings are not concatenated. If both global and chat-specific guidance are needed, include both in the chat override. An empty string suppresses inherited custom instructions; deleting the override restores inheritance.

Example session settings object:

```json
{
  "customInstructions": "Keep replies brief. In this chat, help us plan meals; ask before recording nutrition logs.",
  "pi-coding-agent": {
    "model": { "provider": "VERIFIED_PROVIDER", "name": "VERIFIED_MODEL_ID" },
    "thinkingLevel": "low"
  }
}
```

After writing and validating prompt instructions, use `/new` in that chat to replace the cached prompt. Do not edit `system/SYSTEM.md` as a substitute for user overrides.

## Harness and memory/context model selection

Pi (`pi-coding-agent`) is the current runtime, not a selector for multiple interchangeable harnesses. Use `settings.pi-coding-agent` or its channel/session override. The old top-level `harnesses.pi-coding-agent` shape is legacy migration input; do not introduce it in new edits.

Model roles differ:

- **Chat/harness model:** `pi-coding-agent.model` runs the interactive agent.
- **Chunk contextualizer:** `memory.chunkContextualizerModel` creates retrieval context for transcript chunks. It is not the chat context-window size or a participation switch.
- **Fact extractor:** `memory.factExtractorModel` extracts evidence-backed facts from memory ingestion. It does not choose the embedding model.
- **Fact ingestion mode:** `memory.factIngestionMode` selects `one-shot` or `persistent-pi`; distinct from interactive chat sessions and passive capture.

Example independent memory selections:

```json
{
  "memory": {
    "chunkContextualizerModel": { "provider": "VERIFIED_PROVIDER", "name": "VERIFIED_MODEL_ID" },
    "factExtractorModel": { "provider": "VERIFIED_PROVIDER", "name": "VERIFIED_MODEL_ID" },
    "factIngestionMode": "one-shot"
  }
}
```

These fields participate in settings resolution. Verify the relevant consumer: session ingestion resolves scoped settings, while some memory operations (for example fact-search handling) read global memory configuration. Do not promise every memory operation follows the interactive session's model.

The Settings screen currently exposes the chunk contextualizer model, chat model, OpenRouter route, and thinking level. Fact extractor/mode are schema-supported config fields but are not controls in that screen. The UI displays `low` when thinking level is unset; distinguish display fallback from provider-specific runtime behavior. OpenRouter Auto resets the scoped route override, which can reveal an inherited route rather than erase it globally.

Context, compaction, and retrieval are not arbitrary knobs: top-level `compaction` is accepted as an open object, but schema acceptance alone does not establish an active runtime option. Do not invent context-window, embedding-model, compaction-threshold, or streaming fields. Check consumers before documenting or changing them. `streamMode` is explicitly rejected by current write APIs; `harness` is legacy, not an active settings selector.

## Reload versus fresh session versus restart

- Participation/permission config edits: hot reload; no restart or `/new` needed.
- Chat model edits: runtime reconciles; no service restart needed.
- Prompt-affecting settings, SOUL, custom instructions: `/new` to create a fresh prompt.
- New skills or changed skill descriptions: `/new` for discovery. Existing skill contents can be read immediately.
- Core code changes: build as appropriate and leave restart to the owner. Never restart yourself.
- Never build companion assets over the live served `mobile/dist`.

## Verification sources

When behavior is uncertain, inspect these paths relative to the repository root rather than improvising:

- `src/shared/schemas/vito-config.ts`: accepted fields and PATCH/reset schema.
- `src/shared/defaults.ts` and `src/shared/settings-resolution.ts`: defaults and merge rules.
- `src/services/channels/passive-memory.ts`: invocation permission, silent capture, background context/retrieval.
- `src/services/channels/telegram/TelegramChannelService.ts`: Telegram addressing and delivery gates.
- `src/services/orchestrator/PiOrchestratorService.ts`: mention gating and runtime handling.
- `mobile/src/screens/settings/SettingsScreen.tsx`: dashboard presets and labels.

Keep this document synchronized when those behaviors change. Validation:

```bash
./vito config validate
./vito config validate path/to/another-config.json
```

Success exits 0; invalid config exits 1 with field-specific issues. Do not restart with invalid config.
