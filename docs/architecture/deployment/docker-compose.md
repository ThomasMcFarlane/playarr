# Deploying Streamarr: docker-compose (Tier 2 — small multi-container)

Tier 2 is for operators who want Streamarr and its dependencies managed as
containers — a home server, a small VPS, or anywhere Docker is already the
preferred way to run things — without taking on a full Kubernetes cluster.
It is backed by Postgres, not SQLite (see
[ADR 0001](../adr/0001-storage-engine.md)): every compose file under
`infra/docker/` that runs the real `streamarr` service points it at a
`postgres:16-alpine` service.

## Compose files

Everything lives under `infra/docker/` (paths below are relative to the
repository root; every build here uses build context `../..` so `backend/`
is reachable — see `backend.Dockerfile`'s own header comment for why):

- `backend.Dockerfile` — the multi-stage build (`cargo-chef` for layer
  caching) of the single `streamarr` binary (`backend/`, package
  `streamarr-bin`) into a slim, non-root (`uid`/`gid` `10001`),
  read-only-root-filesystem-friendly runtime image. `EXPOSE 8484` (HTTP)
  and `EXPOSE 9090` (metrics); `HEALTHCHECK` curls `/healthz`.
- `docker-compose.dev.yml` — the local dev stack: Postgres 16 + the six
  *arr apps (Sonarr/Radarr/Lidarr/Bazarr/Prowlarr/Readarr) + Tdarr, **plus
  a real `streamarr` service** built from `backend.Dockerfile`
  (`STREAMARR_ROLE: all`). This is the one compose file in the tree that
  sets the environment variables `streamarr-config::Config::from_env`
  actually reads — see "A real gap" below.
- `docker-compose.ci.yml` — the same dependency set, tuned for CI (tmpfs
  instead of named volumes, fast healthchecks), also with a real
  `streamarr` service built fresh every run. As shipped, this file's
  `streamarr` service cannot boot — see "A real gap" below.
- `docker-compose.mock.yml` — replaces the six *arr containers with
  WireMock instances serving canned JSON fixtures, on the same service
  names/ports `docker-compose.dev.yml` uses, for fast tests of code that
  only needs the HTTP response shape.
- `docker-compose.prod.yml` — the reference multi-node production
  topology: `postgres`, `caddy` (edge/TLS termination, reverse-proxying
  and round-robin load-balancing across every healthy `streamarr-api*`
  container — see `prod/Caddyfile`), and profile-gated
  `streamarr-api`/`streamarr-worker` services. See "Tier selection" below.
- `docker-compose.watchtower.optional.yml` — opt-in overlay for automatic
  image updates, described under "Self-update story" below. Layered in
  with `-f`; does nothing on its own.
- `observability/docker-compose.yml` — optional Prometheus + Grafana
  overlay, run as its own compose project that joins whichever base
  stack's `streamarr-net` network is already running.

There is no `.env.example` file in `infra/docker/` today. Secrets like
`STREAMARR_DB_PASSWORD` are supplied via a `.env` file you create yourself
— `docker-compose.prod.yml` fails loudly (`Set STREAMARR_DB_PASSWORD...`)
if it's missing rather than defaulting to a weak credential — or your
orchestrator's own secret injection.

## Tier selection in `docker-compose.prod.yml`

Rather than a single fixed service list, `docker-compose.prod.yml` uses
named services plus [Compose
profiles](https://docs.docker.com/compose/how-tos/profiles/), so
`docker compose config --services` tells you exactly what a given
invocation contains:

```bash
docker compose -f infra/docker/docker-compose.prod.yml up -d
# -> postgres, caddy, streamarr-api (2 replicas). API/browse traffic
#    only -- no worker means no background transcode/library-scan capacity.

docker compose -f infra/docker/docker-compose.prod.yml --profile standard up -d
# -> adds streamarr-worker (2 replicas).

docker compose -f infra/docker/docker-compose.prod.yml --profile ha up -d
# -> adds redis, plus a second, independently-placed streamarr-api-2 and
#    streamarr-worker-2 ('ha' implies wanting worker capacity too, so
#    streamarr-worker itself also carries the 'ha' profile).
```

`streamarr-api`/`streamarr-api-2`/`streamarr-worker`/`streamarr-worker-2`
are all the exact same image
(`${STREAMARR_IMAGE:-ghcr.io/streamarr/streamarr}:${STREAMARR_IMAGE_TAG:-0.1.0}`,
built from `backend.Dockerfile`) — a direct application of the
single-binary principle in
[`../overview.md`](../overview.md#the-single-role-gated-binary-principle):
there is no separate worker image to build, version, or keep in sync.

## Env-var contract

`streamarr-config::Config::from_env` (`backend/crates/streamarr-config`)
reads exactly these variables: `DATABASE_URL` (required), `REDIS_URL`
(optional), `STREAMARR_ROLE` (`all`/`api`/`worker`, default `all`),
`STREAMARR_LOG` (default `info`), `STREAMARR_HTTP_BIND_ADDR` (default
`0.0.0.0:8484`), `STREAMARR_METRICS_BIND_ADDR` (default `0.0.0.0:9090`),
and `STREAMARR_OTLP_ENDPOINT` (optional). Every compose file in this
directory now sets these real names consistently — an earlier pass had
`backend.Dockerfile`, `docker-compose.ci.yml`, and `docker-compose.prod.yml`
instead setting `APP_ENV`/`LOG_LEVEL`/`LOG_FORMAT`/`METRICS_ENABLED`/
`METRICS_PORT`/`HTTP_PORT` (names copied from the Kubernetes Helm chart's
ConfigMap before either that chart's contract or `streamarr-config` itself
had been confirmed against real code), none of which `Config::from_env`
reads; this has been fixed. `HTTP_PORT`/`METRICS_PORT` still appear in
`backend.Dockerfile` specifically, but now only as Dockerfile-local shell
convenience for its `HEALTHCHECK` curl command — kept in sync by hand with
the port numbers embedded in `STREAMARR_HTTP_BIND_ADDR`/
`STREAMARR_METRICS_BIND_ADDR`, since nothing derives one from the other
automatically.

`backend.Dockerfile`'s baked-in default is `STREAMARR_ROLE=all` (an
earlier pass had `standalone`, which the real `Role` parser rejects
outright — `ConfigError::InvalidValue`, and the container would have
refused to boot; fixed). `docker-compose.dev.yml`, `docker-compose.ci.yml`,
and `docker-compose.prod.yml` (per-service, `api`/`worker`) all set valid
values.

`docker-compose.prod.yml`'s `streamarr-api`/`streamarr-api-2`/
`streamarr-worker`/`streamarr-worker-2` services set `command: ["serve"]`
— the `serve` subcommand takes **no arguments** in the CLI actually
implemented (`backend/src/main.rs`'s `Command::Serve`); there is no
`--role` flag and never was one (an earlier pass had
`command: ["serve", "--role", "api"]`, which would have failed to parse
and crash-looped every one of those four services; fixed). The
`STREAMARR_ROLE` environment variable each service also sets is what
actually selects the role, exactly how the Kubernetes chart already does
it: its Deployment templates set only the `STREAMARR_ROLE` env var and
never override the container's command or args — see
[`kubernetes.md`](kubernetes.md).

## Installing and running

```bash
git clone https://github.com/streamarr/streamarr.git && cd streamarr
echo "STREAMARR_DB_PASSWORD=$(openssl rand -hex 24)" > .env   # or your own secret injection
docker compose -f infra/docker/docker-compose.prod.yml build
docker compose -f infra/docker/docker-compose.prod.yml --profile standard up -d
docker compose -f infra/docker/docker-compose.prod.yml logs -f streamarr-api
```

On first boot, `streamarr` runs its Postgres migrations automatically
before serving traffic (the same `sqlx::migrate!` mechanism described in
[ADR 0001](../adr/0001-storage-engine.md), against the Postgres migration
set). `caddy` is the only service that publishes host ports (`80`, `443`,
`443/udp`); every `streamarr-api*`/`streamarr-worker*` container only
`expose`s `8484`/`9090` on the internal `streamarr-net` network, reached
through Caddy's reverse proxy (`prod/Caddyfile`: round-robin across every
healthy `streamarr-api*` upstream, health-checked against `/healthz`).

## Clustering at this tier

`--profile ha` is this tier's clustering story: a second, independently
schedulable `streamarr-api-2`/`streamarr-worker-2` pair alongside the base
`streamarr-api`/`streamarr-worker`, sharing the same Postgres instance and
— only under `ha` — a shared `redis:7-alpine` service for caching/pub-sub.
`PostgresCoordinator` (`backend/crates/streamarr-coordination`) handles
leader election across however many worker processes are running, the
same mechanism used at Tier 3 — see
[`../distributed-design.md`](../distributed-design.md). Compose alone
can't schedule the `-2` services onto a genuinely different host for real
node-level redundancy (that needs Swarm/Nomad placement constraints, or a
separate Docker context per node); within a single Compose project this
mostly documents the intended topology rather than providing true
multi-host failover.

## Self-update story: `pull` + `up`, optional Watchtower overlay

Like Tier 1, Tier 2 does not update itself unless the operator opts in —
but here the mechanism is standard Docker practice, not a Streamarr CLI
subcommand. (The `streamarr update` subcommand does exist, but as
[`systemd.md`](systemd.md#self-update-story-opt-in-check-only-and-today-largely-stubbed)
describes, its version-check and apply logic are both still stubs today —
it isn't a working update path at any tier yet.)

```bash
docker compose -f infra/docker/docker-compose.prod.yml pull
docker compose -f infra/docker/docker-compose.prod.yml --profile standard up -d
```

`pull` fetches the image for whatever tag `${STREAMARR_IMAGE_TAG:-0.1.0}`
resolves to; `up -d` recreates only the containers whose image actually
changed, and Postgres migrations run automatically on the next
`streamarr-api`/`streamarr-worker` startup.

For automated rollout, `docker-compose.watchtower.optional.yml` is an
**optional overlay**:

```bash
docker compose \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.watchtower.optional.yml \
  --profile standard up -d
```

It does two things: labels every `streamarr-*` service — and only those;
Postgres, Redis, and Caddy are untouched — with
`com.centurylinklabs.watchtower.enable=true`, and repins each from the
exact `MAJOR.MINOR.PATCH` tag the base file defaults to, to a floating
`MAJOR.MINOR` tag (`${STREAMARR_MINOR_TAG:-0.1}`). A real
`containrrr/watchtower` container then polls every 300 seconds
(`--interval 300 --label-enable --cleanup --include-restarting
--rolling-restart`) and recreates a labeled container only when that tag's
registry digest actually changed — a MINOR/MAJOR version bump still
requires a human to edit `STREAMARR_MINOR_TAG` and redeploy. Watchtower
updates containers directly via the Docker Engine API, not through
`docker compose`, so run `docker compose pull && docker compose up -d`
(or drop the overlay) to reconcile Compose's own view of the stack before
your next manual deploy.

`backend.Dockerfile` also creates a root-owned `/.streamarr-container`
marker file, with comments describing an intended future behavior where
`streamarr update` detects it's running inside a container and refuses to
self-update (the image tag *is* the version there, and `docker pull` +
recreate — or Watchtower — is meant to be the correct update path
instead). Nothing in `backend/src/main.rs` reads that marker today —
`streamarr update --yes` returns the same generic "not implemented yet"
error whether it's running in this container image or on bare metal, so
the container-specific refusal doesn't actually happen; there's nothing
implemented yet to refuse with.
