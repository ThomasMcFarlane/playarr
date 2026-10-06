---
title: Choose your setup
summary: Playarr ships as one binary that runs on a single box, a Compose stack or a Kubernetes cluster, pick the shape that matches the hardware you already have.
group: Install
order: 1
badge: Preview
---

Playarr is a single compiled Rust binary called `playarr`. The same artefact serves every deployment shape: what changes between them is where its SQLite file lives and the `PLAYARR_ROLE` you start it with. There is no separate "server edition", no plugin bundle to install, and no configuration file format, all configuration is environment variables, read once at startup.

Read this page, pick a shape, then follow the linked walkthrough. Every shape ends in the same place: [First run](/docs/first-run).

> **Prebuilt releases.** Linux x86-64 and ARM64 tarballs (binary, Admin UI, example systemd units) and a multi-arch container image, `ghcr.io/thomasmcfarlane/playarr`, are published with each server release; get them, with SHA-256 checksums, from [playarr.app/clients/server](https://playarr.app/clients/server). There is still no published Helm chart repository, and the walkthroughs below install from a repository checkout. Treat the shipped systemd units, Compose files and Helm chart as reviewed but not yet verified end to end on live hardware.

## Deployment shapes

Playarr is SQLite-only: every node owns one SQLite database file, and there is no other storage engine to choose. Multi-node setups work through peer sync, where each node keeps its own database and the nodes exchange state with each other.

| | Single server | Docker Compose | Kubernetes |
| --- | --- | --- | --- |
| **Who it suits** | One always-on Linux box you administer by hand. The default, and what most people should run. | You prefer containers and want Playarr managed as one stack on a home server or small VPS. | You already run a cluster and want to host one or more Playarr nodes on it. |
| **Database** | SQLite file, created on first boot | SQLite file on a named volume | SQLite file on a persistent volume, one replica per node |
| **What runs** | One `playarr` process under systemd, role `all` | `caddy` plus one `playarr` container | One single-replica StatefulSet per node |
| **Nodes** | 1 | 1 | 1 per StatefulSet, peer-synced if you run several |
| **Hardware** | Targets NAS boxes (Synology, QNAP), Raspberry Pi 4/5 and other consumer hardware, down to 1-2 GB RAM | Any Docker host | Any cluster |
| **Walkthrough** | [Single server](/docs/install/single-server) | [Docker Compose](/docs/install/docker-compose) | [Kubernetes](/docs/install/kubernetes) |

> **No sizing table exists for the container shapes.** The only hardware figures in the project are the single-server targets above. CPU-per-stream and RAM-per-node guidance has not been measured and is not documented.

### The database URL

`DATABASE_URL` must be a `sqlite:` URL, for example `sqlite:///var/lib/playarr/playarr.db`. A `postgres://` or `postgresql://` URL is rejected at startup with an error: Postgres support was removed (ADR 0002). Schema migrations are embedded in the binary and run automatically at startup. Cache and pub/sub are in-process, and background-loop coordination is in-process too.

> **Moving from a Postgres deployment.** There is no migration tool. If you created a Postgres database for an earlier build, export what you need before upgrading and start again on SQLite.

## Prerequisites common to every shape

- **64-bit Linux.** CI builds release archives for `x86_64-unknown-linux-gnu` and `aarch64-unknown-linux-gnu`, but, per the note above, none has been published yet, so today you produce the binary yourself from a checkout with a Rust toolchain installed. The single-server install additionally requires systemd; the installer refuses to run without `systemctl` on `PATH`.

  ```bash
  # from the repository root; yields backend/target/release/playarr
  cd backend && cargo build --release --locked --bin playarr
  ```

- **`ffmpeg` and `ffprobe` on `PATH`.** Playarr shells out to both for thumbnails, subtitle extraction and on-demand transcoding. The container image installs `ffmpeg` for you; a bare-metal install must supply it. Override the executables with `PLAYARR_FFMPEG_BINARY` and `PLAYARR_FFPROBE_BINARY` if they live somewhere unusual.
- **CPU headroom for transcoding.** The on-demand transcode path uses the software `libx264` encoder. There is no VAAPI, NVENC, QSV or VideoToolbox integration anywhere in the backend, and none of the shipped Compose or Kubernetes manifests pass through `/dev/dri` or request a GPU. Size the box on the assumption that transcoding is done on the CPU.
- **A `DATABASE_URL`.** The only genuinely required variable. The process fails at startup if it is unset or empty.
- **At least one *arr instance.** Playarr integrates with the *arr suite for library management and builds its catalogue by reconciling against the apps you already run. It does not scan folders itself, so a deployment with nothing registered has an empty catalogue. You register instances after first boot, through the admin API or Playarr Admin, nothing needs to be in place before you install.
- **Two ports.** `8484/tcp` for the application (`PLAYARR_HTTP_BIND_ADDR`) and `9090/tcp` for the Prometheus endpoint (`PLAYARR_METRICS_BIND_ADDR`). Both take a full socket address, not a bare port number. `/metrics` should never be reachable from the public edge.
- **A long-lived signing secret.** Set `PLAYARR_JWT_SECRET` to at least 32 bytes. Leave it unset and the server derives a stable secret from its persisted node identity, so sessions survive restarts, but each node derives a different one and tokens are not honoured across nodes.

```bash
openssl rand -hex 32
```

> **Nothing hot-reloads.** Every value is resolved once, at process startup. After editing configuration you must restart the process (`systemctl restart playarr.service`, `docker compose up -d`, or a rollout).

## How media storage is expected to be laid out

Playarr never discovers files on its own. Each media file's path arrives from the *arr instance that owns it, exactly as that app reports it, and the Playarr process then has to be able to `open()` that path on its own filesystem.

That gives you three ways to lay things out, in order of preference:

### 1. Co-locate, and mount at the identical path

The intended arrangement: Playarr runs on (or mounts) the same storage the *arr apps see, at the same absolute path. If Sonarr reports `/mnt/media/tv/…`, then `/mnt/media/tv/…` must resolve for Playarr too. Nothing else to configure.

A **read-only** mount is sufficient for playback and for on-demand transcoding, transcode output is written to the process's temporary directory (`$TMPDIR/playarr-transcode`), never alongside your files.

```yaml
# docker-compose override, the shipped files define no media volume of their own
services:
  playarr-api:
    volumes:
      - /mnt/media:/mnt/media:ro
```

> **The shipped Compose files and Helm chart mount no media at all.** They define volumes for the SQLite database, Caddy and the artwork cache only. Adding the mount that exposes your library is your first edit for Compose and Kubernetes.

### 2. Rewrite one path prefix

If the mount point differs, a network mount at a different local path, say, set both halves of the substitution. Both must be set; setting only one is ignored and the original path is used unchanged. Only a single prefix pair is supported.

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

Artwork, episode thumbnails and extracted subtitles are cached on local disk, there is no object-storage backend of any kind. The caches default to directories beside the database file. If the database URL has no usable parent directory (an in-memory database, say), the artwork cache falls back to the process temp directory and the episode-thumbnail and subtitle caches to the process's *current working directory*, which on a container with a read-only root filesystem is not writable. Set them explicitly if in doubt:

```bash
PLAYARR_ARTWORK_CACHE_DIR=/data/playarr-cache/artwork
PLAYARR_SUBTITLE_CACHE_DIR=/data/playarr-cache/subtitles
```

`PLAYARR_ARTWORK_CACHE_DIR` also relocates episode thumbnails, into an `episode-thumbnails/` subdirectory of that root, so those two variables between them cover all three caches. Whatever paths you pick must be backed by a writable volume: the shipped Compose files do that with the `playarr_prod_artwork_cache` named volume, but the Helm chart sets none of these variables and mounts only an `emptyDir` at `/tmp`, so on Kubernetes the database volume and these variables are yours to add.

## Roles: one binary, three modes

There is no separate API executable, worker executable or coordinator executable, and no `--role` command-line flag. `PLAYARR_ROLE` selects what a given process does:

| `PLAYARR_ROLE` | Serves the HTTP API | Runs background loops | Notes |
| --- | --- | --- | --- |
| `all` *(default)* | Yes | Yes | What the single-server install always runs; the systemd unit hard-codes it. |
| `api` | Yes | No | Catalogue, playback negotiation, authentication, admin routes, and Playarr Admin at `/` when built assets are present. |
| `worker` | No, only `GET /healthz` | Yes | *arr reconciliation pollers, peer-sync pollers and background transcode dispatch. |

Anything other than `all`, `api` or `worker` is a hard startup failure. The `/metrics` listener is spawned by every role, unconditionally.

> **A `worker`-only process does not serve `/readyz`.** Its minimal listener answers `GET /healthz` and nothing else. The shipped Helm chart nevertheless points the worker readiness probe at `/readyz` (`probes.readinessPath` in `values.yaml`), which that listener does not answer, so worker pods would not report Ready until you override the value. This follows from reading the two files together; as above, nobody has yet run the chart on a live cluster to confirm it.

"Coordinator" is not a role. It is an internal, in-process, always-leader component.

**When would you split roles?** Almost never. The `api` and `worker` roles can run as separate processes only if both open the same SQLite file on the same host, so there is no independent scaling to be had. Run `all`.

> **One capability is lost when you split.** Promoting a live on-demand transcode into a durable rendition happens over an in-process channel, so it only works when both roles share a process (`PLAYARR_ROLE=all`). In a split deployment that promotion fails closed; on-demand transcoding itself is unaffected.

## Then what?

| | |
| --- | --- |
| Single always-on Linux box | [Install on a single server](/docs/install/single-server) |
| Containers, one host | [Install with Docker Compose](/docs/install/docker-compose) |
| A cluster you already run | [Install on Kubernetes](/docs/install/kubernetes) |

Whichever you pick, continue to **[First run](/docs/first-run)**, retrieving the generated admin password from the logs, connecting your *arr instances, and signing in from a Playarr client.
