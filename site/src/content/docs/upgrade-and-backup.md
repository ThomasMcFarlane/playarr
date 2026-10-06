---
title: Upgrades and backups
summary: What Playarr state is worth preserving, how to snapshot it safely on each deployment shape, and how to upgrade, roll back and verify a running server.
group: Operate
order: 30
---

Playarr keeps almost everything that matters in one database. Everything else on disk is either
configuration you wrote yourself or a cache the server can rebuild. That makes the operational story
short, but it is worth knowing exactly which files fall into which category before you touch a
running install.

> **Read this first.** The repository documents backups in a single sentence ("Data lives under
> `/var/lib/playarr` … Back that up if you're running SQLite; the database is a single file
> there", `docs/architecture/deployment/systemd.md`). There is **no backup script, no restore
> procedure and no documented rollback** anywhere in the tree. The procedures below marked *general
> guidance* are the standard, safe procedures for SQLite, Playarr's only storage engine, not
> project-documented steps. Test them on your own install before
> relying on them.

## What state actually needs backing up

| State | Matters? | Why |
| --- | --- | --- |
| **The database** (the SQLite file) | **Critical** | Everything durable: catalogue, users and policies, *arr source-instance registrations and their API keys, Tdarr connection, library views, playlists, playback progress, invites, and this installation's Ed25519 node identity. |
| **Configuration**, `/etc/playarr/playarr.env`, your Compose `.env`, or your Helm values file and Kubernetes Secret | **Critical** | Not stored in the database. Losing `PLAYARR_JWT_SECRET` signs every client out. |
| **ACME state**, `PLAYARR_ACME_CACHE_DIR`, default `/var/lib/playarr/acme` | Useful | Holds the Let's Encrypt account and issued certificate. Recoverable by re-issuing, at the cost of rate-limit budget. Only exists if you enabled automatic HTTPS. |
| **Artwork cache**, `PLAYARR_ARTWORK_CACHE_DIR` | Optional | A local copy of artwork already published by your *arr apps. Regenerated on demand; back it up only to avoid a re-fetch storm after a restore. |
| **Episode-thumbnail and subtitle caches** | Optional | Derived from your own files with `ffmpeg`/`ffprobe`. Fully regenerable. |
| **Transcode working directory**, `${TMPDIR}/playarr-transcode` | **No** | Live session scratch only. Never back it up. |
| **Your media files** | Out of scope | Playarr never writes to them. Back them up however you already do. |

Two things Playarr does **not** have, which shortens the list further: there is no object-storage
backend of any kind, and there is no configuration file format, all server configuration is
environment variables.

## Where that state lives

### systemd

| Path | Contents |
| --- | --- |
| `/var/lib/playarr/playarr.db` | The database, assuming `DATABASE_URL=sqlite:///var/lib/playarr/playarr.db`. There is no built-in default, `infra/systemd/playarr.env.example` ships `DATABASE_URL=` empty, so this is a value you set yourself. |
| `/var/lib/playarr/playarr.db-wal`, `…-shm` | SQLite write-ahead log and shared-memory index. Present because Playarr sets `PRAGMA journal_mode = WAL` at startup. |
| `/etc/playarr/playarr.env` | All configuration. Mode `0640`, `root:playarr`. |
| `/var/lib/playarr/cache/artwork` | Default artwork cache when `DATABASE_URL` is a `sqlite://` URL and `PLAYARR_ARTWORK_CACHE_DIR` is unset. |
| `/var/lib/playarr/artwork-cache/episode-thumbnails`, `/var/lib/playarr/subtitle-cache` | Derived caches, co-located with the database file. |
| `/var/lib/playarr/acme` | ACME account and certificate, if automatic HTTPS is enabled. |

The systemd unit's sandbox (`ProtectSystem=strict`,
`ReadWritePaths=/var/lib/playarr /var/log/playarr`) means the service cannot write anywhere else,
so this list is exhaustive by construction. The one exception is scratch: `PrivateTmp=true` gives the
unit its own `/tmp`, which is where the transcode working directory lands and which systemd discards
when the service stops. Nothing there is worth preserving.

### Docker Compose

State lives in named Docker volumes, declared in `infra/docker/docker-compose.prod.yml`:

| Volume | Mounted at | Contents |
| --- | --- | --- |
| `playarr_prod_data` | `/data` | The SQLite database. |
| `playarr_prod_artwork_cache` | `/data/playarr-cache/artwork` | Artwork cache. |
| `caddy_data`, `caddy_config` | Caddy | TLS certificates issued by the edge proxy. |

The containerised single-node stack (`docker-compose.standalone.yml`) is simpler: one volume,
`playarr_standalone_data`, mounted at `/data`, containing `playarr.db` and `cache/artwork`.

> Compose prefixes volume names with the project name. Run
> `docker volume ls | grep playarr` to see the real names on your host before scripting anything
> against them.

### Kubernetes

A Playarr node on Kubernetes is a single-replica Deployment with a persistent volume mounted at
`/data`, holding the SQLite database and the caches. The database is that volume's `playarr.db`. The
state that is also yours to preserve is your Secret and your values file. Playarr is SQLite-only, so
there is no external database to back up.

## Backup procedures

*General guidance, not project-documented. Adapt paths to your install.*

### systemd: a safe SQLite snapshot

Do **not** `cp` a live `playarr.db`. With WAL enabled, recent commits may still be in the `-wal`
file and a bare copy can be inconsistent. Use SQLite's online backup instead, which is safe against a
running server:

```bash
# The backup directory must be writable by the playarr user, because the
# command below runs as that user in order to read the database file
# (/var/lib/playarr is mode 0750, owned playarr:playarr).
sudo install -d -o playarr -g playarr -m 0700 /var/backups/playarr

sudo -u playarr sqlite3 /var/lib/playarr/playarr.db \
  ".backup '/var/backups/playarr/playarr-$(date +%F).db'"
```

`VACUUM INTO` is an equally safe alternative that also compacts the result:

```bash
sudo -u playarr sqlite3 /var/lib/playarr/playarr.db \
  "VACUUM INTO '/var/backups/playarr/playarr-$(date +%F).db'"
```

> The `sqlite3` CLI is not installed by Playarr. Add it first, `apt install sqlite3`,
> `dnf install sqlite`, or your NAS package manager's equivalent.

Then capture configuration and the certificate state:

```bash
sudo tar czf /var/backups/playarr/playarr-config-$(date +%F).tar.gz \
  /etc/playarr/playarr.env \
  /var/lib/playarr/acme
```

> Drop the second path if you never enabled automatic HTTPS, `/var/lib/playarr/acme` does not exist
> on those installs and `tar` will exit non-zero complaining about it, even though it still archives
> the env file.

A cold, belt-and-braces alternative is to stop the service and archive the whole data directory:

```bash
sudo systemctl stop playarr.service
sudo tar czf /var/backups/playarr/playarr-full-$(date +%F).tar.gz \
  -C / etc/playarr var/lib/playarr
sudo systemctl start playarr.service
```

### Containerised (Docker Compose)

The runtime image installs only `ca-certificates`, `curl`, `ffmpeg` and `tini`, so there is no
`sqlite3` inside it. Use a throwaway helper container against the volume:

```bash
docker run --rm \
  -v <YOUR-PROJECT>_playarr_standalone_data:/state \
  -v /var/backups/playarr:/backup \
  alpine:3 sh -c \
  'apk add --no-cache sqlite >/dev/null && \
   sqlite3 /state/playarr.db ".backup /backup/playarr-$(date +%F).db"'
```

> Note the volume is **not** mounted `:ro`. The database is in WAL mode, and opening a WAL database , 
> even only to read it, requires creating or attaching the `-shm` shared-memory index next to it. A
> read-only mount makes the command fail before it starts. `.backup` itself never modifies the source
> database.

### Kubernetes

Run the SQLite online backup inside the pod, which has the database volume mounted, or use Playarr's
built-in backup service. Then capture the Kubernetes-side configuration:

```bash
kubectl get secret playarr-secrets -n playarr -o yaml > playarr-secrets.yaml
helm get values playarr -n playarr -o yaml   > playarr-values.yaml
```

> Back up the Secret wherever your secrets tool already keeps its source of truth rather than as a
> plaintext YAML dump if you can. If your storage class supports volume snapshots, a snapshot of the
> database volume taken while the pod is stopped is a portable second copy.

## How migrations run on upgrade

Schema migrations are **automatic and unconditional**. There is no separate migrate command and no
flag to skip them.

- The migration SQL is compiled into the `playarr` binary at build time
  (`sqlx::migrate!("../../migrations/sqlite")`), so the binary and its schema always
  ship together.
- At every process start, `connect_and_migrate` opens the SQLite pool and runs the migrations
  before any traffic is served, for every `PLAYARR_ROLE`.
- There is one migration set, `backend/migrations/sqlite/`, and its files are never edited after release (sqlx checksums every applied file).
- Applied migrations are recorded in sqlx's own `_sqlx_migrations` table, alongside a separate,
  human-readable `schema_version` table created by `0001_init.sql`.

> **Migrations are forward-only.** Neither migration directory contains any down or reverse SQL.
> Once a newer binary has started against your database, the schema has moved and nothing in the
> product will move it back. This is the single most important fact behind the rollback section
> below.

Practical consequences worth planning around:

- **Take the backup immediately before the upgrade, not on yesterday's schedule.** It is your only
  route back.
- On a multi-node deployment, whichever node starts first runs the migrations; the others find the
  work already done. Migrations are still applied by every role, including workers.
- If `PLAYARR_JWT_SECRET` is unset, a fresh random secret is generated at each boot and every
  client is signed out on restart. Set it before your first upgrade, not after.

## Upgrade procedures

> Releases are published as `v<version>` GitHub Releases with the server tarballs, and the image
> is `ghcr.io/thomasmcfarlane/playarr:<version>`. The Compose files and Helm chart may still
> reference another image name (`ghcr.io/playarr/playarr`); point them at the published image or
> your own build.

### systemd

```bash
# 1. Back up first (see above).

# 2. Build the replacement binary from the updated checkout. 
git -C /path/to/playarr pull
cd /path/to/playarr/backend && cargo build --release --locked --bin playarr
# -> /path/to/playarr/backend/target/release/playarr

# 3. Keep the outgoing binary so you can go back.
sudo cp -a /usr/local/bin/playarr /usr/local/bin/playarr.prev

# 4. Swap in the new binary and restart.
sudo systemctl stop playarr.service
sudo install -o root -g root -m 0755 \
  /path/to/playarr/backend/target/release/playarr /usr/local/bin/playarr
sudo systemctl start playarr.service

# 5. Watch migrations and startup.
journalctl -u playarr.service -f
```

Re-running `sudo ./infra/systemd/install.sh /path/to/playarr` does the same swap and refreshes the
unit files. It never overwrites an existing `/etc/playarr/playarr.env`, and it deliberately does
not enable or start anything, so you finish with `sudo systemctl restart playarr.service`.

> **Playarr Admin's assets are not part of the binary and are not upgraded with it.** Neither the
> binary swap nor `install.sh` touches `PLAYARR_WEB_ASSETS_DIR`. If you co-host the admin UI, rebuild
> and recopy it in the same maintenance window, otherwise you leave an old UI talking to a new API.
> The build and copy steps are on the
> [single-server install page](/docs/install/single-server); in short, from `clients/tv-web`:
>
> ```bash
> pnpm install --frozen-lockfile
> pnpm --filter @playarr-tv/admin... run build
> sudo cp -r admin/dist/. /var/lib/playarr/web/
> sudo chown -R playarr:playarr /var/lib/playarr/web
> ```

> **Self-update does not work yet.** `playarr update --check` makes no network call and always
> reports the running binary as current; `playarr update --yes` always returns "not implemented
> yet" and touches no files. The disabled-by-default `playarr-update-check.timer` is therefore
> inert. Upgrading a systemd install means replacing the binary yourself, as above.

### Docker Compose

The `playarr` service in `docker-compose.prod.yml` inherits the `x-playarr-image` anchor, which sets
**`pull_policy: build`**. Compose therefore skips it on `docker compose pull` and builds rather than
pulls on `up -d`, so the shipped upgrade path is a rebuild from an updated checkout:

```bash
git -C /path/to/playarr pull
docker compose -f infra/docker/docker-compose.prod.yml build
docker compose -f infra/docker/docker-compose.prod.yml up -d
docker compose -f infra/docker/docker-compose.prod.yml logs -f playarr
```

`up -d` recreates only the container whose image ID actually changed. Pin an explicit
`PLAYARR_IMAGE_TAG` in `.env` so each upgrade produces a distinctly named image you can roll back to.

An opt-in Watchtower overlay (`infra/docker/docker-compose.watchtower.optional.yml`) can roll patch
releases automatically. It labels only the `playarr` service and polls every 300 seconds. It does
nothing until a published image exists at the tag it follows, and because Watchtower acts through the
Docker Engine API rather than Compose, reconcile afterwards with `docker compose ... build && docker
compose ... up -d`.

### Kubernetes

Playarr never updates itself inside a cluster: nothing in the repository reaches out to a registry or
patches its own workload.

```bash
# Bump image.tag in your values file, then:
helm upgrade playarr infra/kubernetes/helm/playarr \
  --namespace playarr \
  -f my-values.yaml \
  --wait --timeout 5m

kubectl rollout status deployment/playarr -n playarr
```

With one replica and one volume, expect a short outage while the pod restarts. For the kustomize
path, edit the image tag in your overlay and re-apply with
`kustomize build infra/kubernetes/overlays/prod | kubectl apply -f -`; `overlays/prod` sets
`namespace: playarr-prod`, so adjust the `-n` flag accordingly.

## Rolling back

*General guidance, the repository documents no rollback procedure.*

Because migrations are forward-only, **reverting the binary alone is not a rollback**. An older
binary started against a newer schema is untested and unsupported. A sound rollback therefore always
has two halves: restore the pre-upgrade database, then put the previous version back.

### systemd

```bash
sudo systemctl stop playarr.service

# 1. Restore the database, including a clean removal of stale WAL files.
sudo rm -f /var/lib/playarr/playarr.db \
           /var/lib/playarr/playarr.db-wal \
           /var/lib/playarr/playarr.db-shm
sudo -u playarr cp /var/backups/playarr/playarr-<YYYY-MM-DD>.db \
                     /var/lib/playarr/playarr.db

# 2. Put the previous binary back.
sudo mv /usr/local/bin/playarr.prev /usr/local/bin/playarr

sudo systemctl start playarr.service
```

### Docker Compose

```bash
# 1. Stop the application.
docker compose -f infra/docker/docker-compose.prod.yml stop playarr

# 2. Restore the pre-upgrade database file into the data volume (with the
#    -wal and -shm files removed), as in the systemd steps above.

# 3. Point .env's PLAYARR_IMAGE_TAG back at the previous tag, then bring
#    it back up. If the previous image has been pruned, check out the
#    previous commit and `docker compose ... build` again first.
docker compose -f infra/docker/docker-compose.prod.yml up -d
```

### Kubernetes

`helm rollback` reverts the workload but does nothing to your database volume, so pair it with a
restore of the pre-upgrade database file:

```bash
helm history playarr -n playarr

# 1. Stop the workload.
kubectl scale deployment/playarr --replicas=0 -n playarr

# 2. Restore the pre-upgrade database file onto the volume, then:
helm rollback playarr <REVISION> -n playarr --wait
```

## Verifying health after an upgrade

Work through these in order. The first two need no credentials.

```bash
# Liveness and readiness. /readyz returns 200 only after migrations
# have applied and the pool is connected.
curl -fsS http://<YOUR-SERVER-URL>:8484/healthz
curl -fsS http://<YOUR-SERVER-URL>:8484/readyz

# Version envelope: server version, API version, build SHA and the
# client compatibility table.
curl -fsS http://<YOUR-SERVER-URL>:8484/api/system/version
```

`8484` is `PLAYARR_HTTP_BIND_ADDR`'s port in every shipped configuration. Drop it if you are going
through a reverse proxy on 80/443, the Compose stack's Caddy service, for instance, or a Kubernetes Ingress.

The same handlers are also mounted at `/api/system/health` and `/api/system/ready`.

Then check logs and metrics for your deployment shape:

```bash
# systemd
systemctl status playarr.service
journalctl -u playarr.service --since "10 minutes ago"

# Docker Compose
docker compose -f infra/docker/docker-compose.prod.yml ps
docker compose -f infra/docker/docker-compose.prod.yml logs --since 10m playarr

# Kubernetes
kubectl get pods -n playarr
kubectl logs deployment/playarr -n playarr --since=10m
```

Prometheus metrics are exposed by every role on `PLAYARR_METRICS_BIND_ADDR`, default
`0.0.0.0:9090`:

```bash
curl -fsS http://<YOUR-SERVER-URL>:9090/metrics | head
```

> This listener is deliberately private and carries no authentication of its own. The Compose stack only
> `expose:`s 9090 on the internal Compose network, and the Helm chart never publishes it through an
> Ingress. From outside the host or cluster, reach it with `docker compose exec`, `kubectl
> port-forward`, or from your monitoring network, not from the public interface.

Finally, confirm the parts of the install that depend on database state survived:

1. **Sign in to Playarr Admin** at `/` on the same origin and port as the API. If it 404s, the
   built assets moved, check `PLAYARR_WEB_ASSETS_DIR` and the startup log line about serving the
   API only.
2. **Check your *arr source instances are still registered** under Source Instances. They are
   hydrated from the database at every boot; every write is health-checked, so a stale API key shows
   up immediately. Trigger a reconciliation with
   `POST /api/v1/admin/source-instances/{id}/sync` (or the "Sync now" control) rather than waiting
   for the 300-second poll.
3. **Connect one client** and start playback. This is the only end-to-end check that exercises
   playback negotiation and, if the file needs it, server-side transcoding.

## What the repository does not cover

Stated plainly, so you are not left looking for something that isn't there:

- No rollback procedure is documented for any deployment shape.
- No down or reverse migrations exist, so there is no supported schema downgrade.
- No Postgres migration path exists: Postgres support was removed (ADR 0002) and `DATABASE_URL` must be a `sqlite:` URL.
- No deployment shape has been booted end-to-end and verified in the project's own environment; the
  roadmap describes the Compose, Helm and systemd files as "should work, unverified end-to-end".
  Treat your first upgrade rehearsal as exactly that, a rehearsal, on a copy.
