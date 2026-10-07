# Backup restore drill

Run this drill after any change of backup recipient and periodically (at least quarterly) to prove that a
real backup can be restored with the custodian's recovery key. Creating an archive is not proof of
recoverability; see [server backups](../architecture/server-backups.md).

Use a scratch directory with mode 0700 and never print the key. Nothing is written to, or deleted from, the
running server.

## Procedure

1. Write the recovery identity from the secret store to `<scratch>/identity.txt` with `umask 077`, without
   echoing it.
2. Copy the newest archive and its `.json` sidecar out of the server's backup directory read-only
   (`kubectl cp` or `kubectl exec ... cat > file`). Compare a SHA-256 of the copy with one computed on the
   server.
3. Build `playarr-server` (release) inside a memory scope, for example
   `systemd-run --user --scope -p MemoryHigh=8G -p MemoryMax=12G -p MemorySwapMax=512M -- cargo build --release -j 16 --bin playarr-server`.
4. `playarr-server backup verify --archive <file> --identity-file <identity>` must report the archive verified.
5. `DATABASE_URL=sqlite://<scratch>/restored.db playarr-server backup restore --archive <file>
   --identity-file <identity> --identity clone --dry-run` must complete with nothing changed.
6. Run the same command without `--dry-run` into the empty scratch database. Add `--remap-path OLD=NEW` for
   library roots that exist elsewhere, or `--allow-missing-media` when the media is not mounted on the drill
   host (the database is restored, playback of media files is not).
7. Start the restored copy with `PLAYARR_ROLE=api`, a throwaway `PLAYARR_JWT_SECRET`, and loopback HTTP and
   metrics addresses on free ports, inside a memory scope. Check `/healthz`.
8. Record counts only (users, libraries or source roots, works, watch-progress rows, playlists). Confirm
   that `refresh_token_families` is empty and that `POST /api/v1/auth/refresh` rejects a refresh token with
   HTTP 401, because restore clears sessions and every user signs in again.
9. Stop the server you started. Securely delete (`shred -u`) the restored database and its WAL files, the
   archive copy, the sidecar and the identity file.

## Evidence to keep

The date, the backup id, schema version, the verify, dry-run and restore outcomes, the counts and the
refresh check. Never record media titles, user names, host names or paths.

## Notes

- A restore with `--identity clone` drops the node identity and disables outbound integrations, so the copy
  cannot act as the original.
- The artwork cache is usually larger than the backup size cap and is re-fetched after restore.
- An archive can be read only with the identity matching the recipient it was encrypted to. Archives made
  before a recipient change need the old identity.
