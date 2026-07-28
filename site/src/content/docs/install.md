---
title: Choose your setup
summary: Playarr ships as one binary that runs on a single box, a Compose stack or a Kubernetes cluster — pick the tier that matches the hardware you already have.
group: Install
order: 1
badge: Preview
---

Playarr is a single compiled Rust binary called `playarr`. The same artefact serves every deployment tier: what changes between them is the `DATABASE_URL` you point it at and the `PLAYARR_ROLE` you start it with. There is no separate "server edition", no plugin bundle to install, and no configuration file format — all configuration is environment variables, read once at startup.

Read this page, pick a tier, then follow the linked walkthrough. Every tier ends in the same place: [First run](/docs/first-run).

> **No released version yet.** There is no tagged backend release, no published container image and no published Helm chart repository. Everything below installs from a repository checkout or a binary you build yourself. Treat the shipped systemd units, Compose files and Helm chart as reviewed but not yet verified end to end on live hardware.

## The three tiers

Playarr is designed against three deployment shapes, and every architectural decision in the project is checked against all three. A design that only works on a Raspberry Pi, or only works on Kubernetes, is rejected.

| | Tier 1 — single server | Tier 2 — Docker Compose | Tier 3 — Kubernetes |
| --- | --- | --- | --- |
| **Who it suits** | One always-on Linux box you administer by hand. The default, and what most people should run. | You already prefer containers, and want Playarr plus its database managed as one stack on a home server or small VPS. | You are running Playarr as shared infrastructure and already operate a cluster and a Postgres instance. |
| **Database** | SQLite, embedded, created on first boot | Postgres, run as a container in the same stack | Postgres, pre-existing — the chart never provisions one |
| **What runs** | One `playarr` process under systemd, role `all` | `postgres` + `caddy` + one or more `playarr-api` / `playarr-worker` containers, optionally `redis` | An API Deployment and a worker Deployment, each independently autoscaled, plus a Service per role |
| **Nodes** | 1 | 1–3 | 3+ |
| **Hardware** | Explicitly targets NAS boxes (Synology, QNAP), Raspberry Pi 4/5 and other consumer hardware, down to 1–2 GB RAM | Not documented — see the note below | Not documented — see the note below |
| **Effort** | Run one installer, edit one file, `systemctl enable --now` | Write a `.env`, `docker compose build`, `docker compose up` | Provision Postgres, create a Secret, write a values file, `helm install`, then supply your own ingress |
| **Walkthrough** | [Single server](/docs/install/single-server) | [Docker Compose](/docs/install/docker-compose) | [Kubernetes](/docs/install/kubernetes) |

> **No sizing table exists for Tiers 2 and 3.** The only hardware figures in the project are the Tier 1 targets above, recorded in the storage-engine decision record. CPU-per-stream and RAM-per-node guidance for the larger tiers has not been measured and is not documented — do not treat the Compose file's resource limits (1 CPU / 512 MB for API containers, 2 CPU / 1 GB for workers) as a sizing recommendation.

### How the tier is actually chosen

The tier is **not a flag**. Playarr derives it at startup from two environment variables:

| `DATABASE_URL` | `REDIS_URL` | Resolved tier | Cache and pub/sub | Cluster coordination |
| --- | --- | --- | --- | --- |
| `sqlite:…` | ignored | Single node | In-process, in-memory | No-op coordinator |
| `postgres://…` or `postgresql://…` | unset | Multi-node Postgres | Postgres `LISTEN`/`NOTIFY` | Postgres advisory locks |
| `postgres://…` or `postgresql://…` | set | Multi-node Postgres + Redis | Redis | Postgres advisory locks |

That is the whole mechanism. Pointing the binary at Postgres is what "moves you to Tier 2".

> **There is no data-migration tool between tiers.** Switching `DATABASE_URL` from SQLite to Postgres gives you a working Tier 2 install with an **empty** database — schema migrations are embedded in the binary and run automatically at startup, but nothing exports your existing SQLite rows. Plan a tier change as a fresh start plus re-registering your *arr connections, or stay on the tier you begin with.

## Prerequisites common to every tier

- **64-bit Linux.** CI builds release archives for `x86_64-unknown-linux-gnu` and `aarch64-unknown-linux-gnu`, but — per the note above — none has been published yet, so today you produce the binary yourself from a checkout with a Rust toolchain installed. Tier 1 additionally requires systemd; the installer refuses to run without `systemctl` on `PATH`.

  ```bash
  # from the repository root; yields backend/target/release/playarr
  cd backend && cargo build --release --locked --bin playarr
  ```

- **`ffmpeg` and `ffprobe` on `PATH`.** Playarr shells out to both for thumbnails, subtitle extraction and on-demand transcoding. The container image installs `ffmpeg` for you; a bare-metal install must supply it. Override the executables with `PLAYARR_FFMPEG_BINARY` and `PLAYARR_FFPROBE_BINARY` if they live somewhere unusual.
- **CPU headroom for transcoding.** The on-demand transcode path uses the software `libx264` encoder. There is no VAAPI, NVENC, QSV or VideoToolbox integration anywhere in the backend, and none of the shipped Compose or Kubernetes manifests pass through `/dev/dri` or request a GPU. Size the box on the assumption that transcoding is done on the CPU.
- **A `DATABASE_URL`.** The only genuinely required variable. The process fails at startup if it is unset or empty.
- **At least one *arr instance.** Playarr integrates with the *arr suite for library management and builds its catalogue by reconciling against the apps you already run. It does not scan folders itself, so a deployment with nothing registered has an empty catalogue. You register instances after first boot, through the admin API or Playarr Admin — nothing needs to be in place before you install.
- **Two ports.** `8484/tcp` for the application (`PLAYARR_HTTP_BIND_ADDR`) and `9090/tcp` for the Prometheus endpoint (`PLAYARR_METRICS_BIND_ADDR`). Both take a full socket address, not a bare port number. `/metrics` should never be reachable from the public edge.
- **A long-lived signing secret.** Set `PLAYARR_JWT_SECRET` to at least 32 bytes. Leave it unset and a fresh random secret is generated on every boot, so every client is signed out on restart and no two nodes ever agree.

```bash
openssl rand -hex 32
```

> **Nothing hot-reloads.** Every value is resolved once, at process startup. After editing configuration you must restart the process (`systemctl restart playarr.service`, `docker compose up -d`, or a rollout).

## How media storage is expected to be laid out

Playarr never discovers files on its own. Each media file's path arrives from the *arr instance that owns it, exactly as that app reports it — and the Playarr process then has to be able to `open()` that path on its own filesystem.

That gives you three ways to lay things out, in order of preference:

### 1. Co-locate, and mount at the identical path

The intended arrangement: Playarr runs on (or mounts) the same storage the *arr apps see, at the same absolute path. If Sonarr reports `/mnt/media/tv/…`, then `/mnt/media/tv/…` must resolve for Playarr too. Nothing else to configure.

A **read-only** mount is sufficient for playback and for on-demand transcoding — transcode output is written to the process's temporary directory (`$TMPDIR/playarr-transcode`), never alongside your files.

```yaml
# docker-compose override — the shipped files define no media volume of their own
services:
  playarr-api:
    volumes:
      - /mnt/media:/mnt/media:ro
```

> **The shipped Compose files and Helm chart mount no media at all.** They define volumes for Postgres, Redis, Caddy and the artwork cache only. Adding the mount that exposes your library is your first edit at Tiers 2 and 3.

### 2. Rewrite one path prefix

If the mount point differs — a network mount at a different local path, say — set both halves of the substitution. Both must be set; setting only one is ignored and the original path is used unchanged. Only a single prefix pair is supported.

```bash
PLAYARR_MEDIA_REMOTE_ROOT=/data/media     # the prefix the *arr app reports
PLAYARR_MEDIA_LOCAL_ROOT=/mnt/nas/media   # where that same root is mounted here
```

### 3. Per-node folder mappings

In a multi-node group where different nodes see the library at different places, map a registered instance's root per node without creating a duplicate registration:

```http
PUT /api/v1/admin/source-instances/{id}/folder-mappings
Authorization: Bearer <ADMIN-ACCESS-TOKEN>
Content-Type: application/json

{"folder_mappings": {"<PEER-NODE-UUID>": "/mnt/media/movies"}}
```

### Caches

Artwork, episode thumbnails and extracted subtitles are cached on local disk — there is no object-storage backend of any kind. On SQLite deployments the caches default to directories beside the database file. **On Postgres deployments with nothing set, the fallbacks are poor**: the artwork cache lands in the process temp directory (`$TMPDIR/playarr-artwork`), while the episode-thumbnail and subtitle caches land under the process's *current working directory* — which on a container with a read-only root filesystem is not writable at all. Set them explicitly:

```bash
PLAYARR_ARTWORK_CACHE_DIR=/data/playarr-cache/artwork
PLAYARR_SUBTITLE_CACHE_DIR=/data/playarr-cache/subtitles
```

`PLAYARR_ARTWORK_CACHE_DIR` also relocates episode thumbnails, into an `episode-thumbnails/` subdirectory of that root, so those two variables between them cover all three caches. Whatever paths you pick must be backed by a writable volume: the shipped Compose files do that with the `playarr_prod_artwork_cache` named volume, but the Helm chart sets none of these variables and mounts only an `emptyDir` at `/tmp`, so at Tier 3 both the variables and the volume are yours to add.

## Roles: one binary, three modes

There is no separate API executable, worker executable or coordinator executable, and no `--role` command-line flag. `PLAYARR_ROLE` selects what a given process does:

| `PLAYARR_ROLE` | Serves the HTTP API | Runs background loops | Notes |
| --- | --- | --- | --- |
| `all` *(default)* | Yes | Yes | What Tier 1 always runs; the systemd unit hard-codes it. |
| `api` | Yes | No | Catalogue, playback negotiation, authentication, admin routes, and Playarr Admin at `/` when built assets are present. |
| `worker` | No — only `GET /healthz` | Yes | *arr reconciliation pollers, peer-sync pollers and background transcode dispatch. |

Anything other than `all`, `api` or `worker` is a hard startup failure. The `/metrics` listener is spawned by every role, unconditionally.

> **A `worker`-only process does not serve `/readyz`.** Its minimal listener answers `GET /healthz` and nothing else. The shipped Helm chart nevertheless points the worker readiness probe at `/readyz` (`probes.readinessPath` in `values.yaml`), which that listener does not answer — so worker pods would not report Ready until you override the value. This follows from reading the two files together; as above, nobody has yet run the chart on a live cluster to confirm it.

"Coordinator" is not a role. It is an internal component the binary picks for itself based on the resolved tier — a no-op on SQLite, Postgres advisory locks otherwise — and it is what stops two nodes running the same background loop at once.

**When would you split roles?** Only at Tier 2 or Tier 3, and only against Postgres. The reason is capacity shape: browse and playback traffic scales differently from background transcode and library reconciliation work, and splitting lets you autoscale each independently and give the worker pool its own resource limits and disruption budget. On one box there is nothing to gain — run `all`.

> **One capability is lost when you split.** Promoting a live on-demand transcode into a durable rendition happens over an in-process channel, so it only works when both roles share a process (`PLAYARR_ROLE=all`). In a split deployment that promotion fails closed; on-demand transcoding itself is unaffected.

## Then what?

| | |
| --- | --- |
| Single always-on Linux box | [Install on a single server](/docs/install/single-server) |
| Containers, one host | [Install with Docker Compose](/docs/install/docker-compose) |
| A cluster you already run | [Install on Kubernetes](/docs/install/kubernetes) |

Whichever you pick, continue to **[First run](/docs/first-run)** — retrieving the generated admin password from the logs, connecting your *arr instances, and signing in from a Playarr client.
