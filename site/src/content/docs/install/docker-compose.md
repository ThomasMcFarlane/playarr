---
title: Docker Compose
summary: Run Playarr as a container stack with one server on a SQLite volume, behind Caddy, using the reference Compose topology in the repository.
group: Install
order: 3
badge: Preview
---

This shape runs Playarr as containers on a single Docker host, a home server, a small VPS, or anywhere Docker is already how you run things. The reference topology lives at `infra/docker/docker-compose.prod.yml`: a `caddy` edge proxy and one `playarr` container (role `all`) whose SQLite database lives on a named volume. Playarr is SQLite-only, so there is no database service to run. This page walks the stack from a clean checkout to a healthy server.

> **Nothing here has been booted end to end yet.** The stack builds the image locally from source, and the Compose files have not been verified on live hardware. Expect to read logs.

## What the stack runs

| Service | Image | Role | Published ports |
| --- | --- | --- | --- |
| `playarr` | built from `infra/docker/backend.Dockerfile` | `PLAYARR_ROLE=all`, one replica | none, `expose`s 8484 and 9090 |
| `caddy` | `caddy:2-alpine` | Reverse proxy and TLS | **80, 443, 443/udp** |

Two Docker networks are used: `playarr-net` carries everything, and `playarr-edge` carries only Caddy. Run one `playarr` container per database: two containers must never open the same SQLite file from different hosts. For more than one node, run separate stacks and let them peer-sync.

## Before you start

- A Linux host with Docker Engine and the Compose v2 plugin (`docker compose version`).
- A git checkout of the repository. The host needs enough headroom to compile the Rust binary and build the web assets; the build is multi-stage and not small.
- Your media already on disk, reachable from this host at a stable path.
- Ports 80 and 443 free on the host.

## 1. Get the repository

```bash
git clone https://github.com/ThomasMcFarlane/playarr.git
cd playarr
```

Every build in `infra/docker/` uses the repository root as its build context, so run the commands below from the repository root.

## 2. Write `infra/docker/.env`

The `.env` file must sit next to the Compose file, not at the repository root: Compose resolves it from the directory containing the first `-f` file. `infra/docker/.env` is covered by `.gitignore`. There is no required value; this optional example lists the keys the Compose file interpolates:

```bash
# infra/docker/.env, untracked; never commit this file.

# Caddy's site address. Left at the default, Caddy serves plain HTTP on
# :80 and a locally trusted certificate on :443. Set a real public
# hostname and Caddy obtains a certificate automatically on :443.
PLAYARR_DOMAIN=localhost

# Mapped onto the binary's PLAYARR_LOG (a tracing EnvFilter directive).
PLAYARR_LOG_LEVEL=info
```

> **Compose `.env` values are for interpolation only.** They reach a container solely because `docker-compose.prod.yml` names them in an `environment:` block. Everything else the binary reads goes in the override file in step 3.

## 3. Write an override for media, caches and the rest of the configuration

The reference file mounts no media and sets only the variables it needs. Create `infra/docker/docker-compose.local.yml` (not in the repository; you write it and pass it with a second `-f` on every command):

```yaml
# infra/docker/docker-compose.local.yml, yours, untracked.
services:
  playarr:
    environment:
      # 32 bytes or more. Shorter is ignored with a warning and a secret
      # derived from the node identity is used instead.
      PLAYARR_JWT_SECRET: ${PLAYARR_JWT_SECRET:?Set PLAYARR_JWT_SECRET in infra/docker/.env}
      PLAYARR_AUTH_MODE: full-account
      # Only if the *arr apps report paths that differ from where this
      # host can read them. Both must be set.
      # PLAYARR_MEDIA_REMOTE_ROOT: /data
      # PLAYARR_MEDIA_LOCAL_ROOT: /srv/media
      # Extracted-subtitle cache; needs a volume (see below).
      PLAYARR_SUBTITLE_CACHE_DIR: /data/playarr-cache/subtitles
    volumes:
      # Your media, read-only. Mount it at the SAME path the *arr apps use
      # and no path mapping is needed at all.
      - /srv/media:/srv/media:ro
      - playarr_prod_subtitle_cache:/data/playarr-cache/subtitles

volumes:
  playarr_prod_subtitle_cache:
```

Add the secret to `infra/docker/.env`:

```bash
printf 'PLAYARR_JWT_SECRET=%s\n' "$(openssl rand -hex 32)" >> infra/docker/.env
```

Compose merges `environment` maps and `volumes` lists across `-f` files, so the base file's `DATABASE_URL`, bind addresses and cache directories survive. `docker compose config` shows the merged result.

> **Every writable path must be a volume or a tmpfs.** The base file sets `read_only: true` on the `playarr` service. Only `/tmp` (tmpfs) and explicitly mounted volumes can be written.

> **Mount media at the identical path the *arr apps report, and no path mapping is needed.** Only reach for `PLAYARR_MEDIA_REMOTE_ROOT` / `PLAYARR_MEDIA_LOCAL_ROOT` when you cannot. A single prefix pair is supported.

> **`/data` is the one path you cannot use for media.** The base file mounts volumes beneath `/data`, and Docker cannot create those nested mount points inside a read-only bind mount at `/data`. Mount the tree elsewhere and use the prefix substitution pair.

## 4. Build the image

```bash
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.local.yml \
  build
```

The build is multi-stage: `cargo-chef` dependency caching, the Rust compile of the `playarr` binary, a Node stage that builds Playarr Admin, and a slim runtime that installs `ca-certificates`, `curl`, `ffmpeg` and `tini`. The result runs as non-root uid/gid `10001`, exposes 8484 and 9090, and carries a `HEALTHCHECK` on `/healthz`.

## 5. Bring the stack up

```bash
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.local.yml \
  up -d
```

On first start the `playarr` container creates the SQLite file on its data volume, runs the embedded migrations (there is no migration container and no `migrate` subcommand), seeds first-run state, and provisions a bootstrap admin if the database has no users. Caddy then proxies to it. Follow the logs with `docker compose ... logs -f playarr`.

## 6. Verify

### Container health

```bash
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.local.yml \
  ps
```

Every `playarr-*` container should reach `healthy`, driven by the image's own `HEALTHCHECK`.

### Through the edge

```bash
curl -fsS http://localhost/healthz   && echo OK
curl -fsS http://localhost/readyz    && echo READY
curl -fsS http://localhost/api/system/version
```

`/healthz` is liveness. `/readyz` returns 200 only once startup finished, database opened and migrations applied, and 503 before that. `/api/system/version` is an unauthenticated version envelope. If you set a real `PLAYARR_DOMAIN`, use `https://<YOUR-DOMAIN>/` instead.

### Metrics

Port 9090 is deliberately **not** proxied by Caddy; `/metrics` should never be reachable from the public edge. Reach it over the internal network instead:

```bash
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.local.yml \
  exec playarr \
  curl -fsS http://127.0.0.1:9090/metrics | head
```

### First sign-in

If the database had no users, one admin was provisioned and its password was written to the log **exactly once**, at WARN level:

```bash
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.local.yml \
  logs playarr | grep 'bootstrap admin'
```

The username defaults to `admin`; the password is 64 random hex characters unless you set one. To choose both up front, add them to your override's `x-local-env` block **before the first boot**, they are only consulted when the user table is empty:

```yaml
  PLAYARR_BOOTSTRAP_ADMIN_USERNAME: admin
  PLAYARR_BOOTSTRAP_ADMIN_PASSWORD: ${PLAYARR_BOOTSTRAP_ADMIN_PASSWORD:-}
```

The `playarr` container serves **Playarr Admin** at `/`. Its login identifies itself as
`playarr-admin`, so the non-streaming bootstrap administrator can sign in to the operator UI
without being granted consumer playback access.

The image already serves Playarr Admin at `/`. Two ways forward:

1. **Use the credentials against the API.** Post to `/api/v1/auth/login` with `"client_platform": "playarr-admin"`, which skips the streaming gate. [First run](/docs/first-run) walks through that request and what to do with the token.
2. **Override the bundled Admin build during development.** From your checkout:

   ```bash
   cd clients/tv-web
   pnpm install --frozen-lockfile
   pnpm --filter @playarr-tv/admin... run build
   ```

   Then point the container at the result. Add to your override's `x-local-env`:

   ```yaml
     PLAYARR_WEB_ASSETS_DIR: /srv/playarr-admin
   ```

   and to `x-local-volumes`, using an absolute host path:

   ```yaml
     - /absolute/path/to/playarr/clients/tv-web/admin/dist:/srv/playarr-admin:ro
   ```

   Recreate the container and `/` serves your local admin build. If no `index.html` is found at the resolved path the server runs API-only and logs an informational line saying so, that log line is how you tell a bad path from a bad build.

Either way, create a separate ordinary account with streaming access for actually watching things. The bootstrap admin is an operator account and nothing else.

From here, continue to [First run](/docs/first-run) to register your library managers and connect a client.

## Environment variable reference

Set by `docker-compose.prod.yml` itself:

| Variable | Value in the shipped file |
| --- | --- |
| `DATABASE_URL` | `sqlite:///data/playarr.db`, on the `playarr_prod_data` volume |
| `PLAYARR_ROLE` | `all` |
| `PLAYARR_LOG` | `${PLAYARR_LOG_LEVEL:-info}` |
| `PLAYARR_HTTP_BIND_ADDR` | `0.0.0.0:8484`, a full socket address, not a bare port |
| `PLAYARR_METRICS_BIND_ADDR` | `0.0.0.0:9090`, likewise |
| `PLAYARR_ARTWORK_CACHE_DIR` | `/data/playarr-cache/artwork` |

Worth adding through the override file:

| Variable | Default | Why |
| --- | --- | --- |
| `PLAYARR_JWT_SECRET` | required by the reference file | `docker-compose.prod.yml` refuses to start without it. Under 32 bytes it is ignored with a warning and a secret derived from the node identity is used, which does not agree between containers. |
| `PLAYARR_AUTH_MODE` | `full-account` | `trusted-network` auto-logs in any request from an allowed CIDR with no credentials. |
| `PLAYARR_TRUSTED_NETWORK_CIDR` | RFC 1918 plus loopback | **Replaces** the default allowlist rather than extending it. Only relevant in `trusted-network` mode. |
| `PLAYARR_SUBTITLE_CACHE_DIR` | temp directory | Otherwise extracted subtitles land in the container's tmpfs and are rebuilt after every restart. Must point at a volume mount, the root filesystem is read-only. |
| `PLAYARR_WEB_ASSETS_DIR` | `web/` next to the binary, i.e. `/app/web` in this image | Which built UI is served at `/`. The image ships Playarr Admin here. |
| `PLAYARR_MEDIA_REMOTE_ROOT` / `PLAYARR_MEDIA_LOCAL_ROOT` | unset | Prefix substitution when the path a library manager reports is not the path this host can read. Both required. |
| `PLAYARR_BOOTSTRAP_ADMIN_USERNAME` / `_PASSWORD` | `admin` / random | First-boot admin only; ignored once any user exists. |
| `PLAYARR_OTLP_ENDPOINT` | unset | OTLP collector. When unset, the OpenTelemetry layer is a no-op. |
| `PLAYARR_TRANSCODE_SESSION_IDLE_TTL_SECS` | `60` | Idle deadline for an on-demand transcode session; every manifest or segment request slides it forward. |

Playarr's TLS and ACME variables (`PLAYARR_TLS_CERT_PATH`, `PLAYARR_ACME_DOMAIN` and friends) are not useful here, Caddy terminates TLS at the edge and the Playarr containers speak plain HTTP on the internal network.

## Volumes and state

| Volume | Mounted at | Holds |
| --- | --- | --- |
| `playarr_prod_data` | `/data` | The SQLite database and the artwork cache (`/data/playarr-cache/artwork`). The database is what matters; the cache is rebuildable but slow to rebuild. |
| `caddy_data`, `caddy_config` | Caddy's own paths | Issued certificates and Caddy state. Losing `caddy_data` means re-issuing certificates. |
| `playarr_prod_subtitle_cache` | `/data/playarr-cache/subtitles` | Extracted subtitles, yours, from the override in step 3, not the base file. |

> **Compose names the project after the directory holding the first `-f` file.** That is `infra/docker/`, so the project is called `docker` and every volume above is created with a `docker_` prefix, `docker_playarr_prod_data`, not `playarr_prod_data`. That is what `docker volume ls` shows you, and what any backup you write has to name. Pass `-p playarr` on every invocation if you would rather it were called something else, but be consistent: changing it later orphans the old volumes.

The `playarr` container runs with `read_only: true`, `no-new-privileges:true` and a tmpfs at `/tmp`, and `restart: unless-stopped`. On-demand transcode output goes to `/tmp`, which means it is a RAM disk sized by Docker's default, no environment variable relocates it.

> **Do not copy the live database file.** Playarr can write its own age-encrypted backups, but only once you set `PLAYARR_BACKUP_DIR` and `PLAYARR_BACKUP_RECIPIENTS` in your override file; the reference stack does not. Keep the backup directory on a different volume from `playarr_prod_data`, or copy the archives off the host, because a backup on the same disk does not survive losing it. See [Upgrade and backup](/docs/upgrade-and-backup).

## Hardware acceleration

**Not built yet.** There is no VAAPI, NVENC, QSV, CUDA or VideoToolbox support anywhere in the backend, and no `/dev/dri` device passthrough, NVIDIA runtime or GPU resource request in any Compose file, Dockerfile or Kubernetes manifest in the repository. The on-demand transcode path invokes `ffmpeg` with the software encoder `libx264`. Only the binary paths are overridable, via `PLAYARR_FFMPEG_BINARY` and `PLAYARR_FFPROBE_BINARY`, so substituting a wrapper is possible, but nothing in the product exposes device passthrough as a supported feature, and none of it is documented. Size your host for software encoding.

## Optional: Prometheus and Grafana

`infra/docker/observability/docker-compose.yml` is a separate Compose project that joins the already-running `playarr-net` network as `external`. Start the base stack first, then:

```bash
docker compose -f infra/docker/observability/docker-compose.yml up -d
```

Prometheus lands on host port **9091** (remapped from its in-container 9090) and Grafana on **3000**. Run it as its own project, not merged with `-f` onto the base file, relative bind-mount paths would otherwise resolve against the first file's directory.

## Updating

There is no working self-update . `playarr update --check` makes no network call and always reports the running binary as current; `playarr update --yes` returns "not implemented yet". The image also carries a root-owned `/.playarr-container` marker intended to make the binary refuse to self-update inside a container, but nothing reads it today.

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
  up -d
```

`up -d` recreates only the container whose image actually changed, and migrations run automatically on the next start. Once images are published to a registry, `docker compose pull` replaces the `build` step.

`infra/docker/docker-compose.watchtower.optional.yml` is an opt-in overlay that labels only the `playarr` service for Watchtower, repins them from the exact `MAJOR.MINOR.PATCH` tag to a floating `${PLAYARR_MINOR_TAG:-0.1}`, and runs a real `containrrr/watchtower` container polling every 300 seconds. It needs a published registry image to be of any use, and it acts through the Docker Engine API rather than Compose, so run `docker compose up -d` afterwards to reconcile Compose's own view of the stack.

## More than one node

Playarr is SQLite-only: each stack owns its own database. To run a second node, start a second stack (on another host) and connect the two with peer sync. There is no shared database to point several containers at.

## Licensing

The container images built from `infra/docker/backend.Dockerfile` bundle FFmpeg, which is licensed GPLv2-or-later, while Playarr's own source is MIT, see [Licences and attribution](/legal/licences).
