# Deploying Playarr Server: Docker Compose

Docker Compose is for operators who want Playarr Server managed as a
container on a home server or small VPS, without taking on Kubernetes.
Playarr is SQLite-only ([ADR 0002](../adr/0002-sqlite-only-storage.md),
superseding [ADR 0001](../adr/0001-storage-engine.md)): the compose files run
**one `playarr` container** with the SQLite database file on a named data
volume. There is no database service and no cache service. Several servers
cooperate through peer sync, each with its own stack and database (see
[`../peer-groups.md`](../peer-groups.md)).

## Compose files

Everything lives under `infra/docker/` (paths below are relative to the
repository root; every build here uses build context `../..` so `backend/`
is reachable, see `backend.Dockerfile`'s own header comment):

- `backend.Dockerfile` — the multi-stage build (`cargo-chef` for layer
  caching) of the single `playarr` binary (`backend/`, package
  `playarr-bin`) into a slim, non-root (`uid`/`gid` `10001`),
  read-only-root-filesystem-friendly runtime image. `EXPOSE 8484` (HTTP)
  and `EXPOSE 9090` (metrics); `HEALTHCHECK` curls `/healthz`.
- `docker-compose.dev.yml` — the local dev stack: the six *arr apps
  (Sonarr/Radarr/Lidarr/Bazarr/Prowlarr/Readarr) + Tdarr, plus a real
  `playarr` service built from `backend.Dockerfile` (`PLAYARR_ROLE: all`)
  with its SQLite file on a volume.
- `docker-compose.ci.yml` — the same dependency set, tuned for CI (tmpfs
  instead of named volumes, fast healthchecks).
- `docker-compose.mock.yml` — replaces the six *arr containers with
  WireMock instances serving canned JSON fixtures, for fast tests of code
  that only needs the HTTP response shape.
- `docker-compose.prod.yml` — the reference production stack: the `playarr`
  service (data volume mounted at the data directory) behind `caddy`
  (edge/TLS termination, reverse-proxying to `playarr`; see
  `prod/Caddyfile`).
- `docker-compose.watchtower.optional.yml` — opt-in overlay for automatic
  image updates, described under "Self-update story" below.
- `observability/docker-compose.yml` — optional Prometheus + Grafana
  overlay, run as its own compose project that joins the base stack's
  `playarr-net` network.

## Env-var contract

`playarr-config::Config::from_env` (`backend/crates/playarr-config`)
reads `DATABASE_URL` (required, and it must be a `sqlite:` URL such as
`sqlite:///data/playarr.db?mode=rwc`; a `postgres://` URL fails startup),
`PLAYARR_ROLE` (`all`/`api`/`worker`, default `all`), `PLAYARR_LOG`
(default `info`), `PLAYARR_HTTP_BIND_ADDR` (default `0.0.0.0:8484`),
`PLAYARR_METRICS_BIND_ADDR` (default `0.0.0.0:9090`) and
`PLAYARR_OTLP_ENDPOINT` (optional). Keep the default `PLAYARR_ROLE=all`:
one process owns the database file. The `serve` subcommand takes no
arguments; the role is selected by the environment variable only.

## Installing and running

```bash
git clone https://github.com/ThomasMcFarlane/playarr.git && cd playarr
docker compose -f infra/docker/docker-compose.prod.yml build
docker compose -f infra/docker/docker-compose.prod.yml up -d
docker compose -f infra/docker/docker-compose.prod.yml logs -f playarr
```

On first boot `playarr` creates the SQLite file on the data volume and runs
its embedded migrations before serving traffic (the same `sqlx::migrate!`
mechanism for every deployment). Back the volume up with the server's own
backup feature ([`../server-backups.md`](../server-backups.md)).

## Running more than one server

Do not run two `playarr` containers against the same volume. To serve
several sites or regions, run a separate stack (separate volume, separate
database) per server and join them into a peer group; peer sync replicates
accounts and availability between them
([`../distributed-design.md`](../distributed-design.md)).

## Self-update story: `pull` + `up`, optional Watchtower overlay

Like a systemd install, a Compose deployment does not update itself unless the operator opts in —
but here the mechanism is standard Docker practice, not a Playarr Server CLI
subcommand. (The `playarr update` subcommand does exist, but as
[`systemd.md`](systemd.md#self-update-story-opt-in-check-only-and-today-largely-stubbed)
describes, its version-check and apply logic are both still stubs today —
it isn't a working update path in any deployment yet.)

```bash
docker compose -f infra/docker/docker-compose.prod.yml pull
docker compose -f infra/docker/docker-compose.prod.yml up -d
```

`pull` fetches the image for whatever tag `${PLAYARR_IMAGE_TAG:-0.1.0}`
resolves to; `up -d` recreates only the containers whose image actually
changed, and SQLite migrations run automatically on the next
`playarr` startup.

For automated rollout, `docker-compose.watchtower.optional.yml` is an
**optional overlay**:

```bash
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.watchtower.optional.yml \
  up -d
```

It does two things: labels every `playarr-*` service — and only those;
Caddy and the other services are untouched — with
`com.centurylinklabs.watchtower.enable=true`, and repins each from the
exact `MAJOR.MINOR.PATCH` tag the base file defaults to, to a floating
`MAJOR.MINOR` tag (`${PLAYARR_MINOR_TAG:-0.1}`). A real
`containrrr/watchtower` container then polls every 300 seconds
(`--interval 300 --label-enable --cleanup --include-restarting
--rolling-restart`) and recreates a labeled container only when that tag's
registry digest actually changed — a MINOR/MAJOR version bump still
requires a human to edit `PLAYARR_MINOR_TAG` and redeploy. Watchtower
updates containers directly via the Docker Engine API, not through
`docker compose`, so run `docker compose pull && docker compose up -d`
(or drop the overlay) to reconcile Compose's own view of the stack before
your next manual deploy.

`backend.Dockerfile` also creates a root-owned `/.playarr-container`
marker file, with comments describing an intended future behavior where
`playarr update` detects it's running inside a container and refuses to
self-update (the image tag *is* the version there, and `docker pull` +
recreate — or Watchtower — is meant to be the correct update path
instead). Nothing in `backend/src/main.rs` reads that marker today —
`playarr update --yes` returns the same generic "not implemented yet"
error whether it's running in this container image or on bare metal, so
the container-specific refusal doesn't actually happen; there's nothing
implemented yet to refuse with.
