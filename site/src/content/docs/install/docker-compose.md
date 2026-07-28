---
title: Docker Compose
summary: Run Streamarr as a container stack against Postgres, behind Caddy, using the reference Compose topology in the repository.
group: Install
order: 3
badge: Preview
---

Tier 2 runs Streamarr and its database as containers on a single Docker host — a home server, a small VPS, or anywhere Docker is already how you run things. The reference topology lives at `infra/docker/docker-compose.prod.yml`: a `postgres` service, a `caddy` edge proxy, and one or more `streamarr` containers built from the same image and split by role. This page walks the whole thing from a clean checkout to a healthy stack.

> **Nothing here has been booted end to end yet.** There is no tagged backend release and no container image published to any registry, so the stack builds the image locally from source. The Compose files have been reconciled against the real configuration code but have not been verified on live hardware. Expect to read logs.

## What the stack runs

| Service | Image | Role | Published ports |
| --- | --- | --- | --- |
| `postgres` | `postgres:16-alpine` | Database for every Streamarr container | none — internal only |
| `redis` | `redis:7-alpine` | Optional shared cache and pub/sub, `ha` profile only | none — internal only |
| `streamarr-api` | built from `infra/docker/backend.Dockerfile` | `STREAMARR_ROLE=api`, 2 replicas | none — `expose`s 8484 and 9090 |
| `streamarr-api-2` | same image | `STREAMARR_ROLE=api`, `ha` profile only | none |
| `streamarr-worker` | same image | `STREAMARR_ROLE=worker`, 2 replicas | none |
| `streamarr-worker-2` | same image | `STREAMARR_ROLE=worker`, `ha` profile only | none |
| `caddy` | `caddy:2-alpine` | Reverse proxy, TLS, round-robin across healthy API containers | **80, 443, 443/udp** |

All four `streamarr-*` services are the same image with a different `STREAMARR_ROLE`. There is no separate worker image to build or keep in sync. `serve` takes no command-line arguments — role selection is entirely the environment variable.

Two Docker networks are used: `streamarr-net` carries everything, and `streamarr-edge` carries only Caddy. Caddy sits on both, because it is the only service with a published host port and it must still reach `streamarr-api`.

## Before you start

- A Linux host with Docker Engine and the Compose v2 plugin (`docker compose version`).
- A git checkout of the repository. There is no published image to pull, so the host also needs enough headroom to compile the Rust binary and build the web assets — the build is multi-stage and not small.
- Your media already on disk, reachable from this host at a stable path.
- Ports 80 and 443 free on the host. Nothing else in the stack publishes a port.

## 1. Get the repository

```bash
git clone https://github.com/ThomasMcFarlane/streamarr.git
cd streamarr
```

Every build in `infra/docker/` uses the repository root as its build context, so run the commands below from the repository root exactly as written.

## 2. Write `infra/docker/.env`

`docker-compose.prod.yml` refuses to start without a database password. It uses `${STREAMARR_DB_PASSWORD:?…}`, so an unset value fails the entire `docker compose` invocation with `Set STREAMARR_DB_PASSWORD (e.g. in a .env file) before starting the prod stack` rather than quietly starting with a blank credential.

> **The `.env` file must sit next to the Compose file, not at the repository root.** Compose resolves the default `.env` from the project directory, which is the directory containing the first `-f` file — here, `infra/docker/`. A `.env` at the repository root is silently ignored. `infra/docker/.env` is already covered by `.gitignore`.

There is no `.env.example` anywhere under `infra/docker/`; you create the file yourself. This is a complete example built only from keys `docker-compose.prod.yml` actually interpolates:

```bash
# infra/docker/.env — untracked; never commit this file.

# --- Required ---
# Interpolated into POSTGRES_PASSWORD and into DATABASE_URL. Keep it
# URL-safe: it is substituted directly into a postgres:// URL, so hex or
# base64url output avoids percent-encoding problems.
STREAMARR_DB_PASSWORD=replace-me-with-openssl-rand-hex-24

# --- Optional: edge ---
# Caddy's site address. Left at the default, Caddy serves plain HTTP on
# :80 and a locally trusted certificate on :443. Set a real public
# hostname and Caddy obtains a certificate automatically on :443.
STREAMARR_DOMAIN=localhost

# --- Optional: image coordinates ---
# The image the stack builds and tags. Nothing is published under this
# name yet, so leave these alone unless you push to your own registry.
STREAMARR_IMAGE=ghcr.io/streamarr/streamarr
STREAMARR_IMAGE_TAG=0.1.0

# --- Optional: logging ---
# Mapped onto the binary's STREAMARR_LOG. A tracing EnvFilter directive,
# e.g. info, or info,streamarr_api=debug.
STREAMARR_LOG_LEVEL=info

# --- Optional: only meaningful with --profile ha ---
# Setting this flips the deployment tier from "Postgres" to
# "Postgres + Redis". Leave it blank unless the redis service is running.
STREAMARR_REDIS_URL=

# --- Optional: only read by the Watchtower overlay ---
STREAMARR_MINOR_TAG=0.1
```

Generate the password rather than typing one:

```bash
printf 'STREAMARR_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" > infra/docker/.env
```

> **Compose `.env` values are for interpolation only.** They reach a container solely because `docker-compose.prod.yml` names them in a service's `environment:` block. Adding, say, `STREAMARR_JWT_SECRET` to `.env` does nothing on its own — the shipped file never references it. Everything else the binary reads goes in the override file in step 3.

## 3. Write an override for media, caches and the rest of the configuration

The reference file deliberately mounts no media and sets only the handful of variables it needs. Two things must be added before the stack is genuinely usable, and both belong in your own overlay file rather than an edit to a tracked file.

Create `infra/docker/docker-compose.local.yml`. **This file is not in the repository** — you are writing it now, and you will pass it with a second `-f` on every command.

```yaml
# infra/docker/docker-compose.local.yml — yours, untracked.
#
# Layer onto docker-compose.prod.yml:
#   docker compose \
#     -f infra/docker/docker-compose.prod.yml \
#     -f infra/docker/docker-compose.local.yml \
#     --profile standard up -d

x-local-env: &local-env
  # 32 bytes or more, or it is ignored with a warning and a per-boot
  # random secret is used instead — which signs every client out on
  # restart and means no two containers agree on a token.
  STREAMARR_JWT_SECRET: ${STREAMARR_JWT_SECRET:?Set STREAMARR_JWT_SECRET in infra/docker/.env}
  # full-account is the default: every login needs a real username and
  # password. trusted-network auto-logs in any request from an allowed
  # CIDR with no credentials at all.
  STREAMARR_AUTH_MODE: full-account
  # Only if the *arr apps report paths that differ from where this host
  # can read them. Both must be set, or the substitution is skipped.
  # STREAMARR_MEDIA_REMOTE_ROOT: /data
  # STREAMARR_MEDIA_LOCAL_ROOT: /srv/media
  # Extracted-subtitle cache. Without this it lands in the container's
  # tmpfs and is lost on restart. The path below only works because
  # x-local-volumes mounts a named volume there — every streamarr-*
  # container runs with read_only: true, so any path that is not a volume
  # or a tmpfs cannot even be created, let alone written.
  STREAMARR_SUBTITLE_CACHE_DIR: /data/streamarr-cache/subtitles

x-local-volumes: &local-volumes
  # Your media, read-only. Mount it at the SAME path the *arr apps use
  # and no path mapping is needed at all.
  - /srv/media:/srv/media:ro
  # The artwork cache path the base file already configures. The base
  # file mounts this for the API containers only; the workers warm the
  # same cache and run with a read-only root filesystem, so they need it
  # too.
  - streamarr_prod_artwork_cache:/data/streamarr-cache/artwork
  # Backing store for STREAMARR_SUBTITLE_CACHE_DIR above.
  - streamarr_prod_subtitle_cache:/data/streamarr-cache/subtitles

volumes:
  # streamarr_prod_artwork_cache is already declared by the base file;
  # this one is new, so it has to be declared here.
  streamarr_prod_subtitle_cache:

services:
  streamarr-api:
    environment: *local-env
    volumes: *local-volumes
  streamarr-api-2:
    environment: *local-env
    volumes: *local-volumes
  streamarr-worker:
    environment: *local-env
    volumes: *local-volumes
  streamarr-worker-2:
    environment: *local-env
    volumes: *local-volumes
```

Then add the secret to `infra/docker/.env`:

```bash
printf 'STREAMARR_JWT_SECRET=%s\n' "$(openssl rand -hex 32)" >> infra/docker/.env
```

Compose merges `environment` maps and `volumes` lists across `-f` files, so the base file's `DATABASE_URL`, `STREAMARR_ROLE`, bind addresses and artwork cache directory all survive. Volume entries are merged by target path, so re-listing the artwork cache for the API services is a no-op rather than a duplicate mount. `docker compose config` after step 4 shows you the merged result.

> **Every writable path must be a volume or a tmpfs.** The base file sets `read_only: true` on all four `streamarr-*` services. Only `/tmp` (tmpfs) and explicitly mounted volumes can be written. Pointing a cache variable at a path with no mount behind it does not silently fall back — the container gets `Read-only file system` and that cache is dead.

> **Mount media at the identical path the *arr apps report, and no path mapping is needed at all.** If Sonarr says a file lives at `/srv/media/tv/Show/S01E01.mkv`, mount that same tree at `/srv/media` inside the Streamarr containers. Only reach for `STREAMARR_MEDIA_REMOTE_ROOT` / `STREAMARR_MEDIA_LOCAL_ROOT` when you cannot. Both must be set together; a single prefix pair is supported, and a path that does not match the prefix is passed through unchanged.

> **`/data` is the one path you cannot use for media.** The base file already mounts a volume at `/data/streamarr-cache/artwork`, and Docker cannot create that nested mount point inside a read-only bind mount at `/data`. Try it and the container never starts — `create mountpoint for /data/streamarr-cache/artwork mount: … Read-only file system`. If your *arr apps really do report paths under `/data`, mount the tree somewhere else and use the prefix substitution pair instead:
>
> ```yaml
>   STREAMARR_MEDIA_REMOTE_ROOT: /data
>   STREAMARR_MEDIA_LOCAL_ROOT: /srv/media
> ```

## 4. Choose a profile

`docker-compose.prod.yml` uses Compose profiles for tier selection rather than raw replica counts, so `docker compose config --services` tells you exactly what an invocation contains.

| Invocation | Services started | What you get |
| --- | --- | --- |
| `up -d` | `postgres`, `caddy`, `streamarr-api` (2 replicas) | Browse and API traffic only. **No worker means no background transcode and no library reconciliation.** The smallest useful stack. |
| `--profile standard up -d` | adds `streamarr-worker` (2 replicas) | Transcode and reconciliation capacity. What most single-host operators want. |
| `--profile ha up -d` | adds `redis`, `streamarr-api-2`, `streamarr-worker-2` | `streamarr-worker` carries both the `standard` and `ha` profiles, so `--profile ha` alone still gets worker capacity. Pass both flags for the full set. |

Compose cannot schedule the `-2` services onto a genuinely different host, so within one Compose project they document the intended topology rather than providing real node-level redundancy. That needs a multi-host orchestrator's placement constraints, or a separate Docker context per node.

Check before committing to it:

```bash
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.local.yml \
  --profile standard config --services
```

## 5. Build the image

```bash
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.local.yml \
  build
```

The build is four stages: `cargo-chef` dependency caching, the Rust compile of the `streamarr` binary, a `node:23-slim` stage that runs `pnpm --filter @streamarr-tv/web... run build` and copies `clients/tv-web/web/dist` into `/app/web`, and a `debian:bookworm-slim` runtime that installs `ca-certificates`, `curl`, `ffmpeg` and `tini`. The result runs as non-root uid/gid `10001`, exposes 8484 and 9090, and carries a `HEALTHCHECK` that curls `http://127.0.0.1:8484/healthz` every 30 seconds after a 20-second grace period.

> **The assets baked into `/app/web` are the Playarr Web client, not the admin console.** `backend/src/main.rs` describes the co-hosted assets slot as Streamarr Admin, but `infra/docker/backend.Dockerfile` fills it with the Playarr Web build. The repository is inconsistent here; the Dockerfile is what the image actually does. See [First sign-in](#first-sign-in) below for what that means in practice.

The services set `pull_policy: build`, so `docker compose up` will build the image if it is missing. Building explicitly first just keeps the failure modes separate.

## 6. Bring the stack up

```bash
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.local.yml \
  --profile standard up -d
```

What happens, in order:

1. **Postgres initialises.** The official `postgres:16-alpine` image creates the cluster on first start because `postgres_prod_data` is empty, then creates the `streamarr` database and the `streamarr` role from `POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD`. On every later start the volume is already populated and this is skipped.
2. **Compose waits.** Every `streamarr-*` service declares `depends_on: postgres: condition: service_healthy`, and the `postgres` healthcheck is `pg_isready -U streamarr -d streamarr` every 15 seconds after a 15-second grace period.
3. **Streamarr containers start and migrate.** Each one resolves `DATABASE_URL` to `postgres://streamarr:<your password>@postgres:5432/streamarr`, opens the pool, and runs the embedded Postgres migration set before serving anything. Migrations are compiled into the binary; there is no separate migration container, no `migrate` subcommand to run, and nothing to invoke by hand.
4. **The API containers seed first-run state.** Two default library views are created idempotently, the durable node identity is minted, any previously registered *arr source instances are rehydrated from the database, and — only if the database has no users at all — a bootstrap admin is provisioned.
5. **Caddy starts** and begins round-robin proxying to every healthy `streamarr-api*` container, health-checked against `/healthz` every 10 seconds.

Follow it:

```bash
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.local.yml \
  --profile standard logs -f streamarr-api
```

## 7. Verify

### Container health

```bash
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.local.yml \
  --profile standard ps
```

Every `streamarr-*` container should reach `healthy`, driven by the image's own `HEALTHCHECK`.

### Through the edge

```bash
curl -fsS http://localhost/healthz   && echo OK
curl -fsS http://localhost/readyz    && echo READY
curl -fsS http://localhost/api/system/version
```

`/healthz` is liveness. `/readyz` returns 200 only once startup finished — pool connected and migrations applied — and 503 before that. `/api/system/version` is an unauthenticated version envelope. If you set a real `STREAMARR_DOMAIN`, use `https://<YOUR-DOMAIN>/` instead.

> **Worker containers serve `/healthz` only.** In `worker` role the process runs a minimal listener with just that one route; `/readyz` is not served there. That is fine at this tier, because nothing probes the workers' readiness — but do not point an external monitor at a worker's `/readyz`.

### Metrics

Port 9090 is deliberately **not** proxied by Caddy; `/metrics` should never be reachable from the public edge. Reach it over the internal network instead:

```bash
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.local.yml \
  --profile standard exec --index 1 streamarr-api \
  curl -fsS http://127.0.0.1:9090/metrics | head
```

### First sign-in

If the database had no users, one admin was provisioned and its password was written to the log **exactly once**, at WARN level:

```bash
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.local.yml \
  --profile standard logs streamarr-api | grep 'bootstrap admin'
```

The username defaults to `admin`; the password is 64 random hex characters unless you set one. To choose both up front, add them to your override's `x-local-env` block **before the first boot** — they are only consulted when the user table is empty:

```yaml
  STREAMARR_BOOTSTRAP_ADMIN_USERNAME: admin
  STREAMARR_BOOTSTRAP_ADMIN_PASSWORD: ${STREAMARR_BOOTSTRAP_ADMIN_PASSWORD:-}
```

What the API containers serve at `/` is the **Playarr Web client**, and the bootstrap admin cannot sign in there. Login enforces the account's `can_stream` policy for every client platform except `streamarr-admin`, and the bootstrap admin is created with `can_stream: false` deliberately — so those credentials return a 403 from Playarr Web rather than a token.

Two ways forward, and you will probably want both:

1. **Use the credentials against the API.** Post to `/api/v1/auth/login` with `"client_platform": "streamarr-admin"`, which skips the streaming gate. [First run](/docs/first-run) walks through that request and what to do with the token.
2. **Build Streamarr Admin and serve it instead.** The admin console is a separate workspace package that the image does not build. From your checkout:

   ```bash
   cd clients/tv-web
   pnpm install --frozen-lockfile
   pnpm --filter @streamarr-tv/admin... run build
   ```

   Then point the API containers at the result. Add to your override's `x-local-env`:

   ```yaml
     STREAMARR_WEB_ASSETS_DIR: /srv/streamarr-admin
   ```

   and to `x-local-volumes`, using an absolute host path:

   ```yaml
     - /absolute/path/to/streamarr/clients/tv-web/admin/dist:/srv/streamarr-admin:ro
   ```

   Recreate the API containers and `/` now serves the admin console. If no `index.html` is found at the resolved path the server runs API-only and logs an informational line saying so — that log line is how you tell a bad path from a bad build.

Either way, create a separate ordinary account with streaming access for actually watching things. The bootstrap admin is an operator account and nothing else.

From here, continue to [First run](/docs/first-run) to register your library managers and connect a client.

## Environment variable reference

Set by `docker-compose.prod.yml` itself, per service:

| Variable | Value in the shipped file |
| --- | --- |
| `DATABASE_URL` | `postgres://streamarr:${STREAMARR_DB_PASSWORD}@postgres:5432/streamarr` |
| `REDIS_URL` | `${STREAMARR_REDIS_URL:-}` — optional; only reachable under `--profile ha` |
| `STREAMARR_ROLE` | `api` or `worker`, per service |
| `STREAMARR_LOG` | `${STREAMARR_LOG_LEVEL:-info}` |
| `STREAMARR_HTTP_BIND_ADDR` | `0.0.0.0:8484` — a full socket address, not a bare port |
| `STREAMARR_METRICS_BIND_ADDR` | `0.0.0.0:9090` — likewise |
| `STREAMARR_ARTWORK_CACHE_DIR` | `/data/streamarr-cache/artwork` |

Worth adding through the override file:

| Variable | Default | Why |
| --- | --- | --- |
| `STREAMARR_JWT_SECRET` | random per boot | Under 32 bytes it is ignored with a warning. Unset means every restart signs every client out and no two containers agree on a token. Set it. |
| `STREAMARR_AUTH_MODE` | `full-account` | `trusted-network` auto-logs in any request from an allowed CIDR with no credentials. |
| `STREAMARR_TRUSTED_NETWORK_CIDR` | RFC 1918 plus loopback | **Replaces** the default allowlist rather than extending it. Only relevant in `trusted-network` mode. |
| `STREAMARR_SUBTITLE_CACHE_DIR` | temp directory | Otherwise extracted subtitles land in the container's tmpfs and are rebuilt after every restart. Must point at a volume mount — the root filesystem is read-only. |
| `STREAMARR_WEB_ASSETS_DIR` | `web/` next to the binary, i.e. `/app/web` in this image | Which built UI is served at `/`. The image ships the Playarr Web build here; override it to serve Streamarr Admin instead. |
| `STREAMARR_MEDIA_REMOTE_ROOT` / `STREAMARR_MEDIA_LOCAL_ROOT` | unset | Prefix substitution when the path a library manager reports is not the path this host can read. Both required. |
| `STREAMARR_BOOTSTRAP_ADMIN_USERNAME` / `_PASSWORD` | `admin` / random | First-boot admin only; ignored once any user exists. |
| `STREAMARR_OTLP_ENDPOINT` | unset | OTLP collector. When unset, the OpenTelemetry layer is a no-op. |
| `STREAMARR_TRANSCODE_SESSION_IDLE_TTL_SECS` | `60` | Idle deadline for an on-demand transcode session; every manifest or segment request slides it forward. |

Streamarr's TLS and ACME variables (`STREAMARR_TLS_CERT_PATH`, `STREAMARR_ACME_DOMAIN` and friends) are not useful here — Caddy terminates TLS at the edge and the Streamarr containers speak plain HTTP on the internal network.

## Volumes and state

| Volume | Mounted at | Holds |
| --- | --- | --- |
| `postgres_prod_data` | `/var/lib/postgresql/data` on `postgres` | The database. This is the volume that matters. |
| `streamarr_prod_artwork_cache` | `/data/streamarr-cache/artwork` | Cached artwork. Rebuildable, but slow to rebuild. |
| `redis_prod_data` | `/data` on `redis` | Redis append-only file, `ha` profile only. |
| `caddy_data`, `caddy_config` | Caddy's own paths | Issued certificates and Caddy state. Losing `caddy_data` means re-issuing certificates. |
| `streamarr_prod_subtitle_cache` | `/data/streamarr-cache/subtitles` | Extracted subtitles — yours, from the override in step 3, not the base file. |

> **Compose names the project after the directory holding the first `-f` file.** That is `infra/docker/`, so the project is called `docker` and every volume above is created with a `docker_` prefix — `docker_postgres_prod_data`, not `postgres_prod_data`. That is what `docker volume ls` shows you, and what any backup you write has to name. Pass `-p streamarr` on every invocation if you would rather it were called something else, but be consistent: changing it later orphans the old volumes.

Every `streamarr-*` container runs with `read_only: true`, `no-new-privileges:true` and a tmpfs at `/tmp`, and `restart: unless-stopped`. On-demand transcode output goes to `/tmp`, which means it is a RAM disk sized by Docker's default — no environment variable relocates it.

> **No backup or restore procedure exists in the repository.** There is no `pg_dump` recipe, no snapshot script and no documented restore path. Whatever you build around `postgres_prod_data` is yours to design and yours to test.

## Hardware acceleration

**Not built yet.** There is no VAAPI, NVENC, QSV, CUDA or VideoToolbox support anywhere in the backend, and no `/dev/dri` device passthrough, NVIDIA runtime or GPU resource request in any Compose file, Dockerfile or Kubernetes manifest in the repository. The on-demand transcode path invokes `ffmpeg` with the software encoder `libx264`. Only the binary paths are overridable, via `STREAMARR_FFMPEG_BINARY` and `STREAMARR_FFPROBE_BINARY`, so substituting a wrapper is possible — but nothing in the product exposes device passthrough as a supported feature, and none of it is documented. Size your host for software encoding.

## Optional: Prometheus and Grafana

`infra/docker/observability/docker-compose.yml` is a separate Compose project that joins the already-running `streamarr-net` network as `external`. Start the base stack first, then:

```bash
docker compose -f infra/docker/observability/docker-compose.yml up -d
```

Prometheus lands on host port **9091** (remapped from its in-container 9090) and Grafana on **3000**. Run it as its own project, not merged with `-f` onto the base file — relative bind-mount paths would otherwise resolve against the first file's directory.

## Updating

There is no working self-update at any tier. `streamarr update --check` makes no network call and always reports the running binary as current; `streamarr update --yes` returns "not implemented yet". The image also carries a root-owned `/.streamarr-container` marker intended to make the binary refuse to self-update inside a container, but nothing reads it today.

The real path is rebuild and recreate:

```bash
git pull
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.local.yml \
  build

docker compose \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.local.yml \
  --profile standard up -d
```

`up -d` recreates only the containers whose image actually changed, and migrations run automatically on the next start. Once images are published to a registry, `docker compose pull` replaces the `build` step.

`infra/docker/docker-compose.watchtower.optional.yml` is an opt-in overlay that labels only the `streamarr-*` services for Watchtower, repins them from the exact `MAJOR.MINOR.PATCH` tag to a floating `${STREAMARR_MINOR_TAG:-0.1}`, and runs a real `containrrr/watchtower` container polling every 300 seconds. It needs a published registry image to be of any use, and it acts through the Docker Engine API rather than Compose — so run `docker compose up -d` afterwards to reconcile Compose's own view of the stack.

## Growing out of this tier

Moving to Kubernetes means pointing the same binary at a Postgres instance the cluster already has. See [Kubernetes](/docs/install/kubernetes). Coming the other way from a single-server SQLite install, note that no SQLite-to-Postgres data migration tool exists — the CLI's only subcommands are `serve` and `update`, so moving existing data is on you.

## Licensing

The container images built from `infra/docker/backend.Dockerfile` bundle FFmpeg, which is licensed GPLv2-or-later, while Streamarr's own source is MIT — see [Licences and attribution](/legal/licences).
