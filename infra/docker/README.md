# Streamarr Docker infra

This directory holds every Docker artifact for Streamarr's Tier 2
(docker-compose) deployment target — see
[`docs/architecture/adr/0001-storage-engine.md`](../../docs/architecture/adr/0001-storage-engine.md)
for the three-tier model this fits into, and
[`docs/architecture/overview.md`](../../docs/architecture/overview.md) for
the single-binary/role-gating design `backend.Dockerfile` and every
compose file here assume.

## Files

| File | Purpose |
|---|---|
| `backend.Dockerfile` | Multi-stage Rust build (`cargo-chef` for layer caching) of the `streamarr` binary from `backend/Cargo.toml`'s workspace, into a slim non-root runtime image. |
| `docker-compose.dev.yml` | Local dev dependency stack: Postgres 16 + Sonarr/Radarr/Lidarr/Bazarr/Prowlarr/Readarr/Tdarr. No `streamarr` service (see below). |
| `docker-compose.ci.yml` | Same dependency stack, tuned for CI (tmpfs instead of named volumes, fast healthchecks), plus a `streamarr` service built from `backend.Dockerfile`. |
| `docker-compose.mock.yml` | WireMock stand-ins for the six *arr APIs (`mocks/wiremock/<app>/mappings/*.json`), same service names/ports as `docker-compose.dev.yml`, for fast tests of code that consumes those APIs without booting six real .NET apps. |
| `docker-compose.prod.yml` | Reference multi-node stack: role-split `streamarr-api`/`streamarr-worker` behind Caddy (`prod/Caddyfile`), Postgres, optional Redis, profile-gated tiers. |
| `docker-compose.watchtower.optional.yml` | Opt-in overlay: label-scoped automatic image updates for `streamarr-*` services only. Layer with `-f`; does nothing standalone. |
| `observability/docker-compose.yml` | Optional Prometheus + Grafana overlay. Its own compose project; joins the base stack's `streamarr-net` network. |

## Why `docker-compose.dev.yml` has no `streamarr` service

Per the task this file was scaffolded from: `backend/` did not have a
Dockerfile-buildable release at the time this compose file was written.
`docker-compose.ci.yml` (which always builds fresh from the current commit)
and `docker-compose.prod.yml` (which builds/pulls a tagged release) both
already wire the real binary in. Once `backend/` is buildable and a human
wants `docker-compose.dev.yml` to include it too, add a service there
following the pattern already used in `docker-compose.ci.yml`.

## Assumptions made, and where they came from

`backend/`'s own crates (`streamarr-config`, `streamarr-api`,
`streamarr-telemetry`, etc.) were all still `//! placeholder, filled in
next` stubs when this directory was written — there was no running code to
introspect for the real port numbers, env var names, or health-check
paths. Rather than inventing a contract from scratch, every value below was
taken from **`infra/kubernetes/helm/streamarr/`**, a sibling scaffold
already completed (against, presumably, the same shared design) by the
time this directory was written, cross-checked against
`docs/architecture/overview.md` and `docs/architecture/adr/0001-storage-engine.md`.
Flagging this explicitly because it is an assumption, not a confirmed
contract:

- **App HTTP port: `8080`, not `8096`.** The task this directory was
  scaffolded from asked for "an 8096-style app port." `infra/kubernetes/helm/streamarr/values.yaml`
  (`probes.port`, `config.HTTP_PORT`) and every Deployment template there
  already committed to **`8080`** as the real value. Internal consistency
  between the Helm chart and this directory was judged more valuable than
  literal adherence to "8096-style" (which read as an approximate/
  evocative description — "a Jellyfin-like single web port" — rather than
  a hard number, since the metrics port was given as an exact `9090` in
  the same sentence and 8080 was not similarly hedged in the sibling
  scaffold). **If `8096` was in fact intended as the literal port number,
  reconcile it in both places** — `backend.Dockerfile`'s `ENV HTTP_PORT`/
  `EXPOSE` plus every compose file's `HTTP_PORT`/port mappings here, and
  `infra/kubernetes/helm/streamarr/values.yaml`'s `probes.port`/
  `config.HTTP_PORT` — since the Helm chart was written first, changing it
  is out of this directory's scope (`infra/kubernetes/` is owned by a
  different task).
- **Env var names** (`APP_ENV`, `LOG_LEVEL`, `LOG_FORMAT`,
  `METRICS_ENABLED`, `METRICS_PORT`, `HTTP_PORT`, `STREAMARR_ROLE`,
  `DATABASE_URL`, `REDIS_URL`) are copied verbatim from the Helm chart's
  ConfigMap/Secret templates.
- **Health/readiness paths** (`/healthz`, `/readyz`) and the metrics path
  (`/metrics`, from `serviceMonitor.path`'s default) are likewise from the
  Helm chart.
- **CLI shape** (`streamarr serve --role <api|worker|...>`, defaulting to
  the `STANDALONE` role set when `--role` is omitted) is from
  `docs/architecture/overview.md`'s "single-role-gated-binary principle"
  section, not from actual `backend/src/main.rs` (which didn't exist yet).
- **Non-root UID/GID `10001`** and **read-only-root-filesystem-compatible**
  (only `/tmp` is writable; no `/config`/`/data` volume declared) match the
  Helm chart's `podSecurityContext`/`securityContext` and the fact that its
  Deployment templates mount nothing but a `tmp` `emptyDir`. This also
  matches ADR 0001: Tier 2/3 (docker-compose/Kubernetes) use Postgres, so
  there's no local SQLite file requiring a persistent data directory for
  the `streamarr` container itself.
- **`*_BASE_URL` env vars** wiring `streamarr` to the *arr services in
  `docker-compose.ci.yml` are an outright guess (`streamarr-arr-client`'s
  real config schema doesn't exist yet) — flagged inline in that file.
  Reconcile once that crate defines its actual configuration surface.
- **Image repository** `ghcr.io/streamarr/streamarr` (in `docker-compose.prod.yml`
  and the Watchtower overlay) matches `infra/kubernetes/helm/streamarr/values.yaml`'s
  `image.repository` and `Chart.yaml`'s `sources`/`home` URLs.

## Third-party image choices

- **Postgres**: official `postgres:16-alpine` (Docker Hub).
- **Sonarr/Radarr/Lidarr/Bazarr/Prowlarr**: `lscr.io/linuxserver/<app>:latest`
  (LinuxServer.io's actively maintained images).
- **Readarr**: `lscr.io/linuxserver/readarr:develop`. Readarr has no LSIO
  "stable" release tag as of this writing — `develop` is what LinuxServer
  actually publishes and what upstream Readarr recommends until a stable
  cut exists. Revisit once one does.
- **Tdarr**: `haveagitgat/tdarr:latest` (the image documented at
  `docs.tdarr.io`), configured with `internalNode: true` so the single
  container both serves the UI and runs a worker node — adequate for
  dev/CI; a real deployment would likely add dedicated Tdarr node
  containers instead.
- **WireMock** (`docker-compose.mock.yml`): official `wiremock/wiremock:3.9.1`.
- **Caddy** (`docker-compose.prod.yml`): official `caddy:2-alpine`.
- **Redis** (`docker-compose.prod.yml`, `--profile ha` only): official
  `redis:7-alpine`.
- **Watchtower** (`docker-compose.watchtower.optional.yml`):
  `containrrr/watchtower:latest` — the long-established, widely-published
  image for this tool. Flagged in that file's header: confirm which
  fork/org is the actively maintained publisher before relying on it in
  production, since the project's maintenance status may have changed
  after this was written.
- **Prometheus/Grafana** (`observability/docker-compose.yml`):
  `prom/prometheus:v2.55.1` and `grafana/grafana-oss:11.2.0`.

## Validating without running anything

Every compose file here was checked with `docker compose -f <file> config
--quiet` (renders and validates the merged YAML; does not start, build, or
pull anything) rather than `up`. Re-run the same command after editing any
of these files.

## Known gaps / follow-ups for whoever owns `backend/` next

1. Confirm or correct the `HTTP_PORT=8080` vs "8096-style" question above.
2. Confirm `/healthz`, `/readyz`, `/metrics` are the real route paths once
   `streamarr-api` is implemented (currently a placeholder crate).
3. Confirm the `serve --role <role>` CLI shape and `STREAMARR_ROLE` env
   binding once `streamarr-cli`/`backend/src/main.rs` exist.
4. Define `streamarr-arr-client`'s real config surface and reconcile the
   `*_BASE_URL` env vars guessed in `docker-compose.ci.yml`.
5. `docker-compose.dev.yml` doesn't seed the *arr apps with anything (no
   indexers, no download client, no API keys) — that's `scripts/dev-seed.sh`'s
   job per the `Justfile`'s `dev-seed` recipe, owned by a different task.
