# Appending a Vito Next delta to an existing pHouse user directory

`scripts/merge-vito-next-delta.mjs` is an offline cutover utility for installations
where pHouse already contains the authoritative historical transcript. It starts
from a snapshot of that pHouse user directory and appends only Vito Next rows
that are absent from Vito Next's `migration_id_map`.

It never modifies a source directory, makes network or model calls, controls a
service, or copies Drive, apps, skills, secrets, OAuth state, or Gramps data.

## Inputs

The normalized input is a successfully verified output from
`vito import-vito-next`. The migration-map database is the quiesced Vito Next
History snapshot used to create that output.

```json
{
  "version": 1,
  "baselineUser": "/private/snapshot/phouse-user",
  "importedUser": "/private/snapshot/normalized-vito-next-user",
  "migrationMap": "/private/snapshot/history/messages.sqlite"
}
```

All paths must be absolute. The destination must not exist.

```sh
node scripts/merge-vito-next-delta.mjs \
  --manifest /private/snapshot/delta.json \
  --destination /private/staging/merged-user \
  --dry-run --json
```

Remove `--dry-run` only after the report is accepted. A real run publishes the
fully verified staging directory with an atomic rename and writes
`.vito-next-delta.json` inside it.

## Merge policy

- Existing pHouse sessions, messages, thought/tool rows, application state,
  embeddings, facts, and IDs remain in place.
- `migration_id_map.target` is the authoritative Vito Next boundary. Unmapped
  messages, chunks, and facts receive new IDs above the pHouse maxima.
- Message ranges, evidence, supersession links, vectors, entities, and completed
  chunk runs are remapped without regeneration.
- Current normalized job definitions, safe run history, Discord replay guards,
  token usage, Profile, and Pi session files are retained. Removed-job runs stay
  in inert legacy archive tables.
- Baseline configuration remains authoritative except for normalized Jobs and
  Vito Next per-session settings. Job script paths are rewritten to the requested
  destination.
- Existing foreign-key violations are allowed only when the exact violation set
  is unchanged. Any new or removed violation refuses the merge.
- A pre-existing destination is always refused, including one from an earlier
  successful run.

The final service cutover still requires a fresh quiesced snapshot and separate
operator approval. This utility does not copy its output into the live user
directory or start pHouse.
