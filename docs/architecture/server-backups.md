# Server backups and recovery

Administrator-owned disaster recovery for a whole Playarr Server (epic task 62).
This is not the portable per-user export (task 67). A backup is only "good"
once it has been restored on a replacement instance; creating an archive is
necessary but not sufficient.

## 1. Durable data inventory (task 63)

| Data class | Where it lives | Strategy |
| --- | --- | --- |
| Catalogue (works, seasons, episodes, albums, tracks, books, people, credits, external refs, embeddings) | database | Included. Snapshot. |
| Library/source configuration (`source_instances`, `source_root_folders`, folder mappings, routing rules, group libraries, `tdarr_connection`, library views) | database | Included. Contains upstream API keys, so the archive is always encrypted. |
| Users, policies (permissions), profiles, PINs, avatars, invites and invite requests, per-user playback preferences | database | Included. |
| History and progress (`watch_progress`, `playback_events`, `stats_daily`), playlists and items | database | Included. Order is stored in columns and is preserved. |
| Peer identity and group (`node_identity`, `peer_groups`, `peer_nodes`, sync state, leaf availability, media inventory) | database | Included. Restore policy decides replace versus clone (section 4). |
| Instance settings (`system_settings`) | database | Included. |
| Server-managed assets: artwork cache | `PLAYARR_ARTWORK_CACHE_DIR` (default: next to the SQLite file) | Included in `full` mode when the directory exists. Re-fetchable from the provider if absent, so it is a convenience, not a dependency. |
| Derived caches: thumbnails, subtitle conversions, transcode and HLS output, download staging | local temp/cache | Excluded (regenerable). Listed in the manifest as excluded. |
| Ephemeral coordination (`cluster_leader`, `cache_entries`) | database | Excluded. |
| Sessions (`refresh_token_families`, `playback_sessions`, `download_tickets`, device codes) | database | Captured by the snapshot but cleared on restore (all users sign in again; open download tickets are gone). |
| Media libraries and recordings | external (`/srv/media`, NFS, the media-manager-owned folders) | Never copied. Third-party and operator-owned files are not Playarr data. The manifest lists every source root path so restore can check the replacement mounts. Server-owned recordings do not exist yet; when they do they are a new "assets" class under the same mechanism. |
| Runtime secrets (`DATABASE_URL`, `PLAYARR_JWT_SECRET`, TLS and ACME material, bootstrap credentials) | environment / Kubernetes Secret / volume | Never in the archive. The manifest records which are required (names only); the operator re-supplies them on the replacement. A new `PLAYARR_JWT_SECRET` simply invalidates old tokens. |
| Database credentials and server-side recovery key | n/a | See section 3. |

`mode=database` (set `PLAYARR_BACKUP_MODE=database`) omits the assets class.
Its manifest and the admin UI label it **partial** and name the external storage
and the cache it depends on. `mode=full` is the default.

## 2. Format

`playarr-backup-<UTC timestamp>-<id>.parbak` is `age`-encrypted (X25519
recipients, ChaCha20-Poly1305 streaming) gzip-compressed tar. Entries, in order:

1. `manifest.json`: `format_version`, `backup_id`, `created_at`, server version,
   `engine` (`sqlite` or `postgres`), `schema_version` (highest applied migration),
   `mode` (`full` or `database`, plus `partial: bool`), per-file `sha256` and size,
   per-table row counts, `included` / `excluded` / `unavailable` lists with
   reasons, `external_dependencies` (library root paths, secret names) and the
   node identity (peer id, name).
2. `db/playarr.sqlite` (SQLite engine) or `db/<table>.ndjson` plus
   `db/_tables.json` (PostgreSQL engine; one JSON object per row, tables in
   foreign-key order).
3. `assets/artwork/...` (full mode only).

Next to each archive the server writes `<name>.json`: the manifest summary with
the archive's own SHA-256 and size, written last. The sidecar is the commit
marker. An archive without a sidecar is incomplete by definition.

Engines are never converted. A SQLite backup restores to SQLite, a PostgreSQL
backup to PostgreSQL; restore refuses a mismatch with an explicit message.

## 3. Creation and safety (task 64)

- **Consistency.** SQLite: `VACUUM INTO` produces a transactionally consistent
  copy while writers continue (WAL). PostgreSQL: one `REPEATABLE READ, READ ONLY`
  transaction streams every table, so all tables share one snapshot. Both are
  taken first; the artwork files are referenced by nothing transactionally and
  are copied after, so an artwork file added mid-run is simply absent or extra,
  never a dangling database reference.
- **Atomic publish.** Work happens in `.staging-<id>/`. The archive is written
  to `<name>.parbak.partial`, fsynced, re-read to compute its SHA-256, renamed,
  then the sidecar is written (temp + rename + directory fsync). Interruption
  at any point leaves either nothing or a `.partial`/`.staging` that startup
  and the next run clean up. A destination error (full disk, I/O error) fails
  the run and records a failure; nothing is published.
- **Encryption and recovery key.** Backups are encrypted to one or more age
  public keys configured with `PLAYARR_BACKUP_RECIPIENTS`. The server holds
  public keys only, so a compromised or destroyed server cannot read or lose
  the means to read old backups. The matching private identity is generated
  offline with `playarr-server backup keygen --out <file>` (mode 0600) and is
  held by the administrator independently of the server. The server refuses to
  enable backups with no valid recipient.
- **Retention.** Only after a successful publish, keep the newest `KEEP_LAST`
  (default 7) plus anything younger than `KEEP_DAYS` (default 30), capped so at
  least one complete backup always remains. A failed run never deletes anything.
  Stale staging and partial files older than 24 hours are removed.
- **Bounds.** One run at a time (in-process lock plus a lock file in the
  destination, so two nodes sharing a destination do not collide); streaming
  with fixed buffers (no table or file is held in memory); gzip level 3;
  a free-space check before starting refuses a run when the destination or
  staging area lacks twice the database size.
- **Scheduling.** `PLAYARR_BACKUP_INTERVAL_HOURS` (default 24, 0 = manual only).
  The scheduler runs in the worker loop behind the existing leader gate, so a
  multi-node deployment runs it once.
- **Destination.** A directory (`PLAYARR_BACKUP_DIR`), which may be a mounted
  network share or a separate volume. Remote object storage is out of scope
  for this epic and is tracked as a follow-up row.
- **Access.** Everything is under `/api/v1/admin/backups` and requires an
  administrator. Download streams the already-encrypted archive. The API never
  returns key material, only recipient fingerprints.
- **Reporting.** `GET /api/v1/admin/backups` returns configuration, the current
  run (phase, bytes, started), history from the sidecars and recent failures
  (`failures/*.json` in the destination, retained 30 days).

## 4. Restore (task 65)

Restore is an offline operator action on the replacement instance, run with the
same binary (`playarr-server backup restore`), because replacing the database
under a running server is unsafe. The Admin page shows the exact command.

1. **Validate.** Decrypt with the identity file, stream-verify every entry
   against the manifest checksums, check `format_version`, engine and that the
   archive's `schema_version` is not newer than the binary's. Nothing is
   written to the target yet. `backup verify` stops here.
2. **Stage.** SQLite: restore to a new file beside the target, run
   `PRAGMA integrity_check` and `foreign_key_check`, then apply remaining
   migrations if the archive is older. PostgreSQL: create a staging schema,
   build the schema at the archive's version, load rows in foreign-key order
   inside one transaction, verify row counts against the manifest, then apply
   remaining migrations.
3. **Policy.** Sessions and download tickets are cleared. Library paths can be
   remapped with `--remap-path OLD=NEW` (rewrites source root overrides and
   media paths). Every library root is checked on the replacement; a missing
   or unreadable root is reported and blocks cutover unless
   `--allow-missing-media`. Identity: `--identity replace` (default) keeps the
   peer id and group membership, for a replacement that takes over; use it only
   when the failed server is gone. `--identity clone` drops node identity and
   peer/group rows and disables request forwarding, push registrations and the
   Tdarr connection so a restored copy cannot act as, or on behalf of, the
   original. Source connections otherwise stay configured; start a clone with
   `PLAYARR_ROLE=api` to keep every background poller off.
4. **Cutover.** Only when all checks pass. SQLite: the existing database is
   renamed to `<name>.pre-restore-<timestamp>` and the staged file is renamed
   into place. PostgreSQL: in one transaction the live schema is renamed to
   `pre_restore_<timestamp>` and the staged schema becomes `public`. A failure
   before this step leaves the current installation untouched and removes the
   staging objects. A failure at this step is a rename, so rollback is renaming
   back.
5. A cross-engine restore is refused, not converted.

## 5. Verification (task 66)

Restore tests run against scratch databases only: in-process SQLite files in
temp directories and a throwaway PostgreSQL container with a memory limit.
Live servers only get backup creation. The suite covers:

- round trip on both engines comparing catalogue, users and permissions,
  history, playlist order, settings and library configuration;
- wrong key, truncated or bit-flipped archive, missing manifest entry, wrong
  engine, newer schema, incompatible format version, missing library root,
  destination full or unwritable, interruption between archive and sidecar,
  concurrent writes during the snapshot, concurrent runs, retention never
  removing the last good backup after a failed run, unauthorised API access;
- restored copy run with `PLAYARR_ROLE=api` shows no outbound jobs.

Playback of media and recording schedules cannot be proven where the feature
does not exist; the report states restored coverage and missing dependencies
explicitly, and playback is verified through the restored instance's playback
info endpoint pointing at a test library directory.
