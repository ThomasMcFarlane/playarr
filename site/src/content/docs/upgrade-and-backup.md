---
title: Upgrades and backups
summary: What Playarr state is worth preserving, how to snapshot it safely on each deployment tier, and how to upgrade, roll back and verify a running server.
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
> guidance* are the standard, safe procedures for SQLite and PostgreSQL, the two storage engines
> Playarr actually uses, not project-documented steps. Test them on your own install before
> relying on them.

## What state actually needs backing up

| State | Matters? | Why |
| --- | --- | --- |
| **The database** (SQLite file or PostgreSQL) | **Critical** | Everything durable: catalogue, users and policies, *arr source-instance registrations and their API keys, Tdarr connection, library views, playlists, playback progress, invites, and this installation's Ed25519 node identity. |
| **Configuration**, `/etc/playarr/playarr.env`, your Compose `.env`, or your Helm values file and Kubernetes Secret | **Critical** | Not stored in the database. Losing `PLAYARR_JWT_SECRET` signs every client out. |
| **ACME state**, `PLAYARR_ACME_CACHE_DIR`, default `/var/lib/playarr/acme` | Useful | Holds the Let's Encrypt account and issued certificate. Recoverable by re-issuing, at the cost of rate-limit budget. Only exists if you enabled automatic HTTPS. |
| **Artwork cache**, `PLAYARR_ARTWORK_CACHE_DIR` | Optional | A local copy of artwork already published by your *arr apps. Regenerated on demand; back it up only to avoid a re-fetch storm after a restore. |
| **Episode-thumbnail and subtitle caches** | Optional | Derived from your own files with `ffmpeg`/`ffprobe`. Fully regenerable. |
| **Transcode working directory**, `${TMPDIR}/playarr-transcode` | **No** | Live session scratch only. Never back it up. |
| **Your media files** | Out of scope | Playarr never writes to them. Back them up however you already do. |
| **Redis** (only started by Tier 2's `ha` profile, or provisioned separately for Tier 3) | **No** | Used as a cache and coordination backend, and optional throughout, `REDIS_URL` is an `Option` in the config and is ignored entirely under a `sqlite:` `DATABASE_URL`. Nothing durable lives there. |

Two things Playarr does **not** have, which shortens the list further: there is no object-storage
backend of any kind, and there is no configuration file format, all server configuration is
environment variables.

## Where that state lives, per tier

### Tier 1, systemd + SQLite

| Path | Contents |
| --- | --- |
| `/var/lib/playarr/playarr.db` | The database, assuming `DATABASE_URL=sqlite:///var/lib/playarr/playarr.db`. There is no built-in default, `infra/systemd/playarr.env.example` ships `DATABASE_URL=` empty and comments a PostgreSQL URL, so this is a value you set yourself. `docs/architecture/deployment/systemd.md` names this exact path as the Tier 1 SQLite example. |
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

### Tier 2, Docker Compose + PostgreSQL

State lives in named Docker volumes, declared in `infra/docker/docker-compose.prod.yml`:

| Volume | Mounted at | Contents |
| --- | --- | --- |
| `postgres_prod_data` | `/var/lib/postgresql/data` on the `postgres` service | The database. |
| `playarr_prod_artwork_cache` | `/data/playarr-cache/artwork` on `playarr-api` and `playarr-api-2` | Artwork cache. `PLAYARR_ARTWORK_CACHE_DIR` is set to this path for *all* four `playarr-*` services by the shared env anchor, but only the two API services actually mount the volume. |
| `caddy_data`, `caddy_config` | Caddy | TLS certificates issued by the edge proxy. |
| `redis_prod_data` | `/data` on `redis` | Cache only, skip it. |

Plus the `.env` file next to your compose invocation, which holds `PLAYARR_DB_PASSWORD`.

The containerised single-node stack (`docker-compose.standalone.yml`) is simpler: one volume,
`playarr_standalone_data`, mounted at `/data`, containing `playarr.db` and `cache/artwork`.

> Compose prefixes volume names with the project name. Run
> `docker volume ls | grep playarr` to see the real names on your host before scripting anything
> against them.

### Tier 3, Kubernetes

The Helm chart provisions **no** database and **no** PersistentVolumeClaim. Each pod mounts only an
`emptyDir` at `/tmp` and runs with a read-only root filesystem. Consequences:

- **The database is not yours to back up from the chart.** It belongs to whatever provisioned your
  PostgreSQL instance, a cloud managed service, an operator, or a separate Helm release.
- The chart sets none of the cache directory variables, so the artwork cache falls back to the
  process temp directory and is discarded on every pod restart. Nothing to back up; expect artwork
  to be re-fetched after a rollout.
- The state that *is* yours to preserve is your Secret and your values file.

## Backup procedures

*General guidance, not project-documented. Adapt paths to your install.*

### Tier 1: a safe SQLite snapshot

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

### Tier 1 containerised (Docker standalone)

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

### Tier 2: a PostgreSQL dump

Take a custom-format dump straight out of the `postgres` service. This is safe while Playarr is
running:

```bash
# The shell redirect below runs as you, not as root, so own the directory.
sudo install -d -o "$USER" -g "$USER" -m 0700 /var/backups/playarr

docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres \
  pg_dump -U playarr -d playarr --format=custom --no-owner \
  > /var/backups/playarr/playarr-$(date +%F).dump
```

`-T` disables TTY allocation, without it the dump is corrupted by terminal translation.

Back up the artwork cache volume only if you want to avoid re-fetching:

```bash
docker run --rm \
  -v <YOUR-PROJECT>_playarr_prod_artwork_cache:/state:ro \
  -v /var/backups/playarr:/backup \
  alpine:3 tar czf /backup/artwork-$(date +%F).tar.gz -C /state .
```

And keep a copy of the `.env` file holding `PLAYARR_DB_PASSWORD` somewhere your database backup
is not, restoring one without the other leaves you with a database you cannot connect to.

### Tier 3: dump from a helper pod

```bash
kubectl run playarr-pgdump \
  --namespace playarr \
  --rm -i --restart=Never \
  --image=postgres:16-alpine \
  --env="PGPASSWORD=<YOUR-DB-PASSWORD>" \
  --command -- pg_dump \
    -h <YOUR-POSTGRES-HOST> -U playarr -d playarr \
    --format=custom --no-owner \
  > playarr-$(date +%F).dump
```

Use `-i` without `-t`; a TTY will corrupt the binary stream. Then capture the Kubernetes-side
configuration:

```bash
kubectl get secret playarr-secrets -n playarr -o yaml > playarr-secrets.yaml
helm get values playarr -n playarr -o yaml   > playarr-values.yaml
```

> The chart defaults to `secret.create: false`, so in most installs the Secret holding `DATABASE_URL`
> and `REDIS_URL` was provisioned out of band, by Sealed Secrets, External Secrets Operator or a
> plain `kubectl create secret`. `playarr-secrets` is only the name the chart falls back to when
> `secret.name` is empty; substitute whatever you actually set, and back it up wherever that tool
> already keeps its source of truth rather than as a plaintext YAML dump if you can.

If your PostgreSQL is a managed service, prefer its own scheduled snapshot facility and treat the
`pg_dump` above as a portable second copy.

## How migrations run on upgrade

Schema migrations are **automatic and unconditional**. There is no separate migrate command and no
flag to skip them.

- The migration SQL is compiled into the `playarr` binary at build time
  (`sqlx::migrate!("../../migrations/sqlite")` and `…/postgres`), so the binary and its schema always
  ship together.
- At every process start, `connect_and_migrate` opens the pool and runs the migration set that
  matches the `DATABASE_URL` scheme, before any traffic is served, on every tier and every
  `PLAYARR_ROLE`.
- Two separate sets exist and are never mixed: `backend/migrations/sqlite/` (41 files today, up to
  `0041_peer_media_inventory.sql`) and `backend/migrations/postgres/` (43 files, up to
  `0044_peer_media_inventory.sql`; the numbering has gaps).
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

> No backend release has been published yet, there is no `backend-v*` tag in the repository, and
> the image name referenced by the Compose files and Helm chart
> (`ghcr.io/playarr/playarr`) has not been confirmed against a real published image. The
> mechanics below are correct; the artefact you point them at is your own build until releases
> begin.

### Tier 1, systemd

```bash
# 1. Back up first (see above).

# 2. Build the replacement binary from the updated checkout. Both database
#    drivers are compiled into every build, so one artefact serves any tier.
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

### Tier 2, Docker Compose

Every `playarr-*` service in `docker-compose.prod.yml` inherits the `x-playarr-image` anchor,
which sets **`pull_policy: build`**. Compose therefore *skips those services entirely* on
`docker compose pull`, and builds rather than pulls on `up -d`. The file's own usage header says as
much: `docker compose -f infra/docker/docker-compose.prod.yml build`. So the shipped upgrade path is
a rebuild from an updated checkout:

```bash
git -C /path/to/playarr pull
docker compose -f infra/docker/docker-compose.prod.yml build
docker compose -f infra/docker/docker-compose.prod.yml --profile standard up -d
docker compose -f infra/docker/docker-compose.prod.yml logs -f playarr-api
```

`up -d` recreates only the containers whose image ID actually changed. PostgreSQL, Redis and Caddy
have no `pull_policy` override, so they are still pulled normally by `docker compose pull`.

The image reference is `${PLAYARR_IMAGE:-ghcr.io/playarr/playarr}:${PLAYARR_IMAGE_TAG:-0.1.0}`,
so a build tags the result locally under that name. Pin an explicit tag in `.env` so each upgrade
produces a distinctly named image you can roll back to:

```bash
# .env
PLAYARR_IMAGE_TAG=0.1.1
```

> **To pull a published image instead of building**, you must remove or override `pull_policy: build`
>, for example with a small override file passed as a second `-f`. The repository ships no such
> override, and no published image has been confirmed to exist (see the note above), so this is
> currently a path you would have to construct yourself.

An opt-in Watchtower overlay
(`infra/docker/docker-compose.watchtower.optional.yml`) can roll patch releases automatically. It
labels only the `playarr-*` services, PostgreSQL, Redis and Caddy are never touched, because
Watchtower is started with `--label-enable`, and repins them to a floating
`${PLAYARR_MINOR_TAG:-0.1}` tag, polling every 300 seconds. Two things follow:

- It only does anything once a published image actually exists at that tag. Until then the overlay is
  inert.
- Watchtower acts through the Docker Engine API rather than Compose, so after it swaps an image the
  running container disagrees with what Compose would produce. The overlay's own header tells you to
  run `docker compose pull && docker compose up -d` to reconcile; with `pull_policy: build` in force,
  the reconciling command is in practice `docker compose … build && docker compose … up -d`.

### Tier 3, Kubernetes

Playarr never updates itself inside a cluster by design: nothing in the repository reaches out to
a registry or patches its own workload.

```bash
# Bump image.tag in your values file, then:
helm upgrade playarr infra/kubernetes/helm/playarr \
  --namespace playarr \
  -f my-values.yaml \
  --wait --timeout 5m

kubectl rollout status deployment/playarr-api    -n playarr
kubectl rollout status deployment/playarr-worker -n playarr
```

Deployment names come from the chart's `playarr.fullname` helper: with a release named `playarr`
they are `playarr-api` and `playarr-worker`. A different release name changes both.

> **Expect `--wait` and the worker's `rollout status` to time out** unless you have already worked
> around the worker readiness-probe mismatch described under *Verifying health after an upgrade*
> below. The worker Deployment's readiness probe targets a path the worker role does not serve. Read
> that caveat before your first cluster upgrade, not after.

For the kustomize path, edit the image tag in your overlay and re-apply:

```bash
kustomize build infra/kubernetes/overlays/prod | kubectl apply -f -
```

Note that `overlays/prod` sets `namespace: playarr-prod`, not `playarr`, adjust the `-n` flag on
every command above accordingly if you took the kustomize route. That overlay also inherits
`base/secret.yaml`'s empty placeholder, which its own comments tell you to strip out and replace with
a real secrets provider before using it for anything you care about.

`infra/kubernetes/flux-image-automation.example.yaml` sketches a GitOps route that commits tag bumps
back to git behind a pull request. It is an example file, not wired into any live Flux resource in
this repository, and the required `# {"$imagepolicy": …}` marker comment is not present in
`values.yaml` or `base/kustomization.yaml` by default, adding it is a deliberate opt-in.

## Rolling back

*General guidance, the repository documents no rollback procedure.*

Because migrations are forward-only, **reverting the binary alone is not a rollback**. An older
binary started against a newer schema is untested and unsupported. A sound rollback therefore always
has two halves: restore the pre-upgrade database, then put the previous version back.

### Tier 1

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

### Tier 2

```bash
# 1. Stop the application, leave PostgreSQL running.
docker compose -f infra/docker/docker-compose.prod.yml stop \
  playarr-api playarr-api-2 playarr-worker playarr-worker-2

# 2. Restore the dump.
docker compose -f infra/docker/docker-compose.prod.yml exec -T postgres \
  pg_restore -U playarr -d playarr --clean --if-exists \
  < /var/backups/playarr/playarr-<YYYY-MM-DD>.dump

# 3. Point .env's PLAYARR_IMAGE_TAG back at the previous tag, then bring
#    it back up. `up -d` reuses the locally tagged image if it is still
#    present; if it has been pruned, check out the previous commit and
#    `docker compose ... build` again first.
docker compose -f infra/docker/docker-compose.prod.yml --profile standard up -d
```

> Step 1 names `playarr-api-2` and `playarr-worker-2`, which only exist under the `ha` profile.
> Naming a service explicitly activates its profile for that command, so the `stop` is safe to run
> as written on a `standard`-profile stack, the two `-2` services are simply not running.

### Tier 3

`helm rollback` reverts the workload but does nothing to your database, so pair it with a restore:

The chart enables autoscaling for **both** roles by default (`api.autoscaling.enabled: true`,
`worker.autoscaling.enabled: true`, with `minReplicas` of 2 and 1). A live HPA overrides
`kubectl scale`, so scaling to zero will not stick, the HPA scales the Deployment straight back up
to its `minReplicas`. Quiesce the HPAs first:

```bash
helm history playarr -n playarr

# 1. Remove the autoscalers, otherwise the scale-to-zero below is undone
#    within one HPA sync interval.
kubectl delete hpa playarr-api playarr-worker -n playarr

# 2. Stop the workload.
kubectl scale deployment/playarr-api    --replicas=0 -n playarr
kubectl scale deployment/playarr-worker --replicas=0 -n playarr

# 3. Restore the dump against your PostgreSQL instance, then:
helm rollback playarr <REVISION> -n playarr --wait
```

`helm rollback` re-renders the chart from the target revision, so the two HPAs are recreated as part
of the rollback and replica counts return to their autoscaled range. If you would rather not delete
them, `helm upgrade --set api.autoscaling.enabled=false --set worker.autoscaling.enabled=false` has
the same effect and is reversed by the rollback in the same way.

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
through a reverse proxy on 80/443, Tier 2's Caddy service, for instance, or a Kubernetes Ingress.

The same handlers are also mounted at `/api/system/health` and `/api/system/ready`.

Then check logs and metrics for the tier you are on:

```bash
# Tier 1
systemctl status playarr.service
journalctl -u playarr.service --since "10 minutes ago"

# Tier 2
docker compose -f infra/docker/docker-compose.prod.yml ps
docker compose -f infra/docker/docker-compose.prod.yml logs --since 10m playarr-api

# Tier 3
kubectl get pods -n playarr
kubectl logs deployment/playarr-api -n playarr --since=10m
```

Prometheus metrics are exposed by every role on `PLAYARR_METRICS_BIND_ADDR`, default
`0.0.0.0:9090`:

```bash
curl -fsS http://<YOUR-SERVER-URL>:9090/metrics | head
```

> This listener is deliberately private and carries no authentication of its own. Tier 2 only
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

> **Known caveat on worker-only pods.** When `PLAYARR_ROLE` is not `api` or `all`, the process does
> not run the public API router at all; it serves a minimal listener with `GET /healthz` and nothing
> else. `/readyz` is not mounted on that listener. Both the Helm chart
> (`probes.readinessPath: /readyz` in `values.yaml`) and the kustomize base
> (`infra/kubernetes/base/deployment-worker.yaml`, hard-coded `/readyz`) nonetheless point the worker's
> readiness probe at it, so a worker pod can be expected to never report Ready and
> `helm upgrade --wait` / `kubectl rollout status` will hang until they time out.
>
> There is **no per-role probe value to override**, `probes.readinessPath` is a single global setting
> shared by both Deployments, so setting it to `/healthz` would also downgrade the API's readiness
> gate from "migrations applied and pool connected" to "process is up". Until the chart grows separate
> probe blocks, the honest options are to patch the worker Deployment's readiness probe after
> rendering (a kustomize patch, or `kubectl patch deployment playarr-worker`), or to accept that the
> worker never reports Ready and drop `--wait` from your upgrade command. The repository documents no
> preferred resolution.

## What the repository does not cover

Stated plainly, so you are not left looking for something that isn't there:

- No backup script, restore script, snapshot tooling or scheduled-backup example exists in the tree.
- No rollback procedure is documented for any tier.
- No down or reverse migrations exist, so there is no supported schema downgrade.
- There is no SQLite-to-PostgreSQL data migration tool. Pointing `DATABASE_URL` at PostgreSQL
  changes the deployment tier and coordinator, but moving existing rows across is on you.
- No deployment tier has been booted end-to-end and verified in the project's own environment; the
  roadmap describes the Compose, Helm and systemd files as "should work, unverified end-to-end".
  Treat your first upgrade rehearsal as exactly that, a rehearsal, on a copy.
