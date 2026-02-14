# Restart Skill

**Description:** Restart the Vito server process via PM2 without killing the orchestrator. Use this after code changes or when channels need to reload.

Restart the Vito server using PM2 without killing the orchestrator process.

## When to use

- After code changes that require a server restart
- When Telegram, WebSocket, or other channels need to reload
- When configuration changes require a process restart

## Usage

Simply invoke this skill and it will restart the server via PM2.

## What it does

1. Runs `pm2 restart vito-server`
2. The server process restarts while the orchestrator keeps running
3. All channels (Telegram, WebSocket, Dashboard) reconnect automatically

## Output

Returns the PM2 restart status message.
