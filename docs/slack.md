# Slack channel

Vito uses Slack's official Socket Mode and Web API SDKs. Socket Mode connects outward from the server, so no public webhook or signing secret is needed. One installation connects to one Slack workspace.

## Setup

1. Create an app at [Slack apps](https://api.slack.com/apps), choosing **From a manifest**, and import [slack-app-manifest.json](slack-app-manifest.json).
2. Install the app in your workspace. Save its **Bot User OAuth Token** (`xoxb-…`) as `SLACK_BOT_TOKEN` in Vito's Secrets dashboard.
3. Under **Basic Information → App-Level Tokens**, generate an app-level token with `connections:write`. Save the token (`xapp-…`) as `SLACK_APP_TOKEN` in Secrets. The manifest enables Socket Mode, message subscriptions, interactivity, and the `/vito` command.
4. Enable Slack in Vito's channel settings. Set owner user IDs for restart access and, if desired, workspace, channel, and user allowlists. Empty allowlists permit users/channels in the connected workspace. DMs can be disabled separately; channel allowlists apply to channels and group conversations, while the user/workspace allowlists also apply to DMs.
5. Restart Vito, invite the bot to the channels it should use, then mention it or send it a DM.

The example config leaves Slack disabled and requires mentions in channels. DMs always count as mentioning Vito. Existing installations can add this configuration:

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "settings": { "requireMention": true },
      "allowedWorkspaceIds": ["T0123456789"],
      "allowedChannelIds": [],
      "allowedUserIds": [],
      "ownerIds": ["U0123456789"],
      "allowDms": true
    }
  }
}
```

Merge it into your existing config rather than replacing other channels. Run `npm run validate:config` after a manual edit. Enabling Slack or changing its tokens requires a restart; allowlist and owner changes apply to subsequent events without restarting.

## Conversations and output

Top-level messages share a session per workspace/channel (including each DM conversation). Existing Slack threads have independent sessions, and Vito replies within the originating thread. Targets are `WORKSPACE:CHANNEL` or `WORKSPACE:CHANNEL:THREAD_TIMESTAMP`; session IDs prefix these with `slack:`. Scheduled delivery can use these same targets.

The shared relay presents provider-authored progress summaries and tool activity in a temporary card, public commentary as permanent messages, and a clean final reply. The card links to the conversation in Vito's dashboard and is removed at message boundaries and completion. Slack's bot APIs do not provide a normal typing indicator here, so Vito adds a temporary hourglass reaction to the incoming message. Long replies are split while preserving fenced code. Local `MEDIA:<path>` output uploads files; Drive files fall back to a dashboard link if uploading fails.

Incoming Slack files are downloaded with the bot token and saved in Vito's Drive. Both download and upload have a 20 MiB file limit. Bot messages, edits, deletes, and system events do not start turns. Message/event retries are deduplicated in a persistent inbox. Queued turns survive restarts; turns interrupted while active or steering are recorded as interrupted and are not replayed automatically, because they may have already performed work.

## Controls and steering

Use `/vito help`, `/vito stop`, `/vito status`, `/vito new`, `/vito compact`, `/vito model [provider/model]`, `/vito session [id]`, `/vito login [provider]`, or `/vito restart`. The shared orchestrator handles these controls, including model switching, compaction, session selection, and cancellation. Only configured owners can restart Vito.

Slack slash commands do not provide the originating thread timestamp. To control an existing thread, send a normal message within that thread, for example `@Vito /stop` or `@Vito /model openrouter/meta/muse-spark-1.3`. `/vito` controls target the channel's top-level session. `/stop` clears that session's pending input immediately and aborts its active turn; other controls queue in order.

If you send another text message while Vito is busy, it normally queues. **Steer now** on its queue notice sends it to the active turn instead. Only that message's sender can steer it, and only from its original workspace/channel/thread. Attachments and control commands cannot be used as steering. A successful steering request consumes the queued item, so it is not executed again as a separate turn.

Slack commands are installed through the app manifest rather than a Discord-style command registration API. The dashboard exposes Slack setup, allowlists, secrets, and session alias refresh. Reimport the manifest when changing app permissions or commands; reinstall the Slack app when required by Slack.

References: [Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/), [Node SDK](https://docs.slack.dev/tools/node-slack-sdk/socket-mode), [app manifests](https://docs.slack.dev/reference/app-manifest/), [message API](https://docs.slack.dev/reference/methods/chat.postMessage/).
