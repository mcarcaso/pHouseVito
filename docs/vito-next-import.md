# Importing Vito Next core data

`vito import-vito-next` is the offline, one-time bridge from a quiesced Vito Next
installation to a fresh pHouseVito user directory. It performs no network, model,
credential, service-control, or source-write operations.

## Snapshot requirements

Stop or fully quiesce both runtimes before the final snapshot. Capture each SQLite
database with SQLite's backup API or `VACUUM INTO`; do not copy a live database
without its WAL. The importer rejects source databases with adjacent `-wal` or
`-shm` files and runs `PRAGMA integrity_check` before reading them.

Create a private manifest containing explicit absolute paths:

```json
{
  "version": 1,
  "history": "/snapshot/history/messages.sqlite",
  "semanticMemory": "/snapshot/semantic-memory/memory.sqlite",
  "facts": "/snapshot/facts/facts.sqlite",
  "jobs": "/snapshot/jobs/jobs.sqlite",
  "discord": "/snapshot/discord/discord.sqlite",
  "usage": "/snapshot/token-meter/usage.sqlite",
  "profile": "/snapshot/profile/profile.md",
  "config": "/snapshot/config.json",
  "sessions": "/snapshot/sessions",
  "controls": "/snapshot/sessions/controls",
  "sessionNames": "/snapshot/sessions/names.json",
  "discordAttachments": "/snapshot/discord/outbox",
  "embedding": {
    "model": "text-embedding-3-small",
    "dimensions": 1536
  }
}
```

The declared embedding identity and dimensions must match every imported vector.
Job script paths are read from the Jobs database, validated as regular files,
included in the source fingerprint, and copied into the destination.

## Rehearse and import

The destination must not exist. First run the complete conversion in disposable
staging:

```sh
./vito import-vito-next \
  --manifest /private/snapshot/import.json \
  --destination /private/restored-user \
  --dry-run
```

Then publish the verified directory atomically:

```sh
./vito import-vito-next \
  --manifest /private/snapshot/import.json \
  --destination /private/restored-user
```

`--json` emits the stable report. A successful destination contains
`.vito-next-import.json` with source and output checksums. Repeating the exact
import verifies that receipt and returns `already-imported`. A different snapshot,
changed destination, unsupported mapping, malformed reference, active WAL, or
ambiguous session/job delivery is refused without publishing partial output.

## Mapping and replay policy

- History IDs and source metadata are retained. Sessions bound to one Discord
  conversation are combined under pHouseVito's canonical `discord:CHANNEL` session;
  the exact source-to-target mapping is archived and reported.
- Pi JSONL files are copied into the mapped pHouseVito conversation directories.
  The current source session remains the newest resumable conversation.
- Profile text is copied byte-for-byte. Global, per-conversation model settings,
  timezone, Discord response/mention settings, user/channel allowlists, and DM
  policy are translated without copying credentials.
- Semantic chunks, message ranges, context, vectors, search content, Facts sets,
  facts, evidence, entities, fact vectors, chunk runs, and legacy decision data
  are preserved. Existing chunks and completed Facts runs are not sent through a
  model again. Processing runs are held from replay.
- Script Jobs and scripts are copied. Known `discord.deliver` destinations are
  translated. Unknown delivery operations fail closed. Running jobs become
  interrupted; pending delivery becomes unknown and is never blindly retried.
- Discord cursors are retained. Pending/active inputs and incomplete output
  deliveries are archived and marked interrupted/unknown, never replayed.
- Token usage is retained in `token_usage`.
- Staged Discord outbox files are retained under `legacy/discord-outbox` but are
  not delivered automatically.
- Secrets, provider credentials, apps, skills, Drive contents, and service state
  are deliberately outside this importer. Copy or configure them separately
  while both runtimes remain stopped.

## Cutover gate

After import, verify both SQLite databases with `PRAGMA integrity_check`, review the
report and generated config, reconcile extensions/secrets/Drive, start only
pHouseVito, and test Dashboard, Discord, History, Facts, Jobs, and attachments.
On any failure, stop pHouseVito and return to the untouched Vito Next data. Keep
that source snapshot unchanged for at least one week.
