# Channel participation and passive memory

Discord, Slack, and Telegram share one local background-capture path. No channel-history API is called to enrich turns automatically. The channel must be permitted and the platform must deliver the message; the implementation cannot reconstruct pre-installation, retention-expired, or missed offline messages.

## Settings

These settings cascade global → channel → session, like `requireMention`:

- `requireMention`: existing response gate; false participates in every permitted message.
- `passiveMemory`: false by default. When true, silent permitted human messages are stored and checked by the existing chunk/contextualization/embedding/fact pipeline, without a Pi turn.
- `rememberUserIds`: `"everyone"` (default), `"nobody"`, or an array of platform user IDs. An empty array allows nobody. This governs passive background only.
- `invokeUserIds`: `"everyone"`, `"nobody"`, or an array of platform user IDs. When unset, existing channel `allowedUserIds` remains the invocation fallback; an absent/empty legacy list means everyone. Restricted lists fail closed when sender identity is unavailable. Existing transport/owner checks on slash commands and privileged controls still apply.

The dashboard offers three participation presets:

1. Always participate: `requireMention: false`, `passiveMemory: false`.
2. Listen, respond on mention: both true.
3. Mention only: `requireMention: true`, `passiveMemory: false`.

Speaker lists are independent of these presets. Normal invocation requests and agent responses remain normal conversation history even when the sender is excluded from passive memory. Bots are excluded from passive capture. An authorized unmentioned deterministic control still works; passive-capture authorization cannot grant command access.

## Capture and retrieval

Passive rows live in the ordinary messages database, with a deduplicated platform-message index. Each accepted silent message kicks off a non-forced chunk check. Undersized buffers remain pending; existing memory finalization handles remainders. Attribution includes the speaker name and platform ID. Remote attachment metadata is recorded without downloading silent attachments.

Passive rows are explicitly excluded from fresh Pi history seeding. They do not increase live Pi context or require Pi compaction. Database/embedding/fact storage still grows; this feature does not add automatic deletion or a new retention policy.

On a normal turn, the latest five eligible background messages before the triggering timestamp are included chronologically, with an exact count of locally captured omitted messages. The successful-turn cursor advances to the trigger timestamp, not response time. Failed or aborted turns do not advance it. Later chatter is left for subsequent turns. Counts explicitly do not claim complete platform history.

`conversation_background_history` is a read-only Pi tool bound to the current session. It pages backward using local message IDs, at most 50 messages per call. The upper timestamp boundary comes from the active turn, not model arguments. Speaker permissions and passive-memory enablement are rechecked on every retrieval. Cursor coverage does not mean every omitted message was inspected.

Changing a remember list prevents future capture and excludes existing disallowed rows from automatic background/history-tool results. It does not retroactively erase already created embeddings, facts, Pi context, or database records. Existing memory search is not a new per-speaker security boundary; deployments needing deletion must explicitly remove previously retained data.

## Platform visibility

- Discord needs channel/thread access, message content visibility, and the relevant gateway intents. No history permission is needed for this local capture path.
- Slack must subscribe to ordinary message events for the desired conversation types, not only `app_mention`, with the required scopes and conversation membership.
- Telegram group privacy must allow ordinary messages (disable privacy through BotFather or use appropriate bot-admin visibility). Bot API cannot fetch arbitrary historical messages. Pending updates are no longer deliberately dropped on startup, but Telegram's update retention still limits outage recovery.

Configuration and source changes do not enable passive memory in an existing deployment automatically. Restart and dashboard publication remain owner-controlled.
