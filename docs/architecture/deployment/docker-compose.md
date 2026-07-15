# Deploying Streamarr: docker-compose (Tier 2 — small multi-container)

Tier 2 is for operators who want Streamarr and its dependencies managed as
containers — on a home server, a small VPS, or anywhere Docker is already
the preferred way to run things — and who may want to run a small, fixed
handful of nodes (1–3) rather than a single systemd process. It is backed
by Postgres rather than SQLite (see [ADR 0001](../adr/0001-storage-engine.md)),
because a real database server is a normal, expected part of a
docker-compose topology in a way it isn't for Tier 1's unattended NAS
target.

## Compose files

The infra tier ships from the repository root:

- `docker-compose.prod.yml` — the primary compose file: the `streamarr`
  service (image built from `crates/streamarr-cli`, or pulled from the
  published registry), a `postgres` service, and a `tdarr-node` service for
  background transcode work (see
  [`../overview.md`](../overview.md#the-tdarr-background-vs-on-demand-transcode-split)).
- `.env.example` — the template for the `.env` file `docker-compose.prod.yml`
  reads its secrets and paths from (`POSTGRES_PASSWORD`,
  `STREAMARR_MEDIA_ROOT`, `STREAMARR_DATA_DIR`, `STREAMARR_LISTEN_PORT`).
- `docker-compose.watchtower.yml` — an optional overlay adding a
  [Watchtower](https://containrrr.dev/watchtower/) service, described under
  self-update below. Not applied by default.

Representative service shape in `docker-compose.prod.yml`:

```yaml
services:
  streamarr:
    image: streamarr/streamarr:${STREAMARR_TAG:-latest}
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      STREAMARR_ROLE: standalone
      STREAMARR_DATABASE_BACKEND: postgres
      STREAMARR_DATABASE_URL: postgres://streamarr:${POSTGRES_PASSWORD}@postgres:5432/streamarr
    volumes:
      - ${STREAMARR_DATA_DIR}:/data
      - ${STREAMARR_MEDIA_ROOT}:/media:ro
    ports:
      - "${STREAMARR_LISTEN_PORT:-8443}:8443"

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: streamarr
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: streamarr
    volumes:
      - streamarr-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U streamarr"]
      interval: 5s
      timeout: 5s
      retries: 10

  tdarr-node:
    image: streamarr/streamarr:${STREAMARR_TAG:-latest}
    restart: unless-stopped
    command: ["serve", "--role", "worker"]
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      STREAMARR_ROLE: worker
      STREAMARR_DATABASE_BACKEND: postgres
      STREAMARR_DATABASE_URL: postgres://streamarr:${POSTGRES_PASSWORD}@postgres:5432/streamarr
    volumes:
      - ${STREAMARR_DATA_DIR}:/data
      - ${STREAMARR_MEDIA_ROOT}:/media

volumes:
  streamarr-pgdata:
```

`tdarr-node` is the same `streamarr` image invoked with `--role worker`
rather than a separate build — a direct application of the
single-role-gated-binary principle in
[`../overview.md`](../overview.md#the-single-role-gated-binary-principle):
scaling background transcode capacity at this tier is
`docker compose up -d --scale tdarr-node=3`, not building or maintaining a
different image.

## Installing and running

```bash
git clone https://github.com/streamarr/streamarr.git && cd streamarr
cp .env.example .env
$EDITOR .env   # set POSTGRES_PASSWORD, STREAMARR_MEDIA_ROOT, STREAMARR_DATA_DIR
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f streamarr
```

On first boot, the `streamarr` service runs its Postgres migrations
automatically before serving traffic (the same `sqlx::migrate!` path
described in [ADR 0001](../adr/0001-storage-engine.md), against the
Postgres migration set rather than SQLite's).

## Clustering at this tier

Running more than one `streamarr --role api` container behind a shared
Postgres is supported at Tier 2 (e.g. two `streamarr` service replicas
under a local load balancer), using `PostgresCoordinator` for leader
election and node heartbeat exactly as described in
[`../distributed-design.md`](../distributed-design.md). This is a smaller,
manually-managed version of the Kubernetes story in
[`kubernetes.md`](kubernetes.md) — no autoscaling, no rolling-update
orchestration, just a fixed compose-defined replica count an operator
chooses and scales by hand with `docker compose up -d --scale streamarr=N`.
On-demand transcode session affinity (signed-redirect routing, per
[`../distributed-design.md`](../distributed-design.md)) applies identically
here once more than one `streamarr` API replica is running.

## Self-update story: `pull` + `up`, optional Watchtower overlay

Like Tier 1, Tier 2 does not update itself unless the operator opts in —
but the *mechanism* here is standard Docker practice rather than a
Streamarr-specific subcommand, because pulling a new image tag is already
how Docker deployments are normally updated:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

`pull` fetches any updated images for the tag pinned in `.env`
(`STREAMARR_TAG`, defaulting to `latest` but recommended to be pinned to a
specific release tag for anything beyond casual use — see the N-2
compatibility guarantee in
[`../../versioning-policy.md`](../../versioning-policy.md) for why staying
on a pinned, deliberately-chosen tag is safer than always tracking
`latest`); `up -d` recreates only the containers whose image actually
changed, and Postgres migrations run automatically on the `streamarr`
container's next startup, same as a first install.

For operators who want this automated, `docker-compose.watchtower.yml` is
an **optional overlay**, applied explicitly:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.watchtower.yml up -d
```

Watchtower is configured to act only on containers explicitly opted in via
a label (`com.centurylinklabs.watchtower.enable=true`) rather than watching
every container on the host by default — so enabling the overlay does not
silently start auto-updating `postgres` or any other unrelated container
sharing the Docker host. `streamarr` and `tdarr-node` carry that label in
the base compose file; Watchtower is inert unless its overlay is explicitly
composed in, matching the opt-in posture used at every tier.
