# Playarr Server Docker infra

This directory holds every Docker artifact for Playarr Server's Tier 2
(docker-compose) deployment target — see
[`docs/architecture/adr/0001-storage-engine.md`](../../docs/architecture/adr/0001-storage-engine.md)
for the three-tier model this fits into, and
[`docs/architecture/overview.md`](../../docs/architecture/overview.md) for
the single-binary/role-gating design `backend.Dockerfile` and every
compose file here assume.

## Files

| File | Purpose |
|---|---|
| `backend.Dockerfile` | Multi-stage Rust build (`cargo-chef` for layer caching) of the `playarr` binary from `backend/Cargo.toml`'s workspace, into a slim non-root runtime image. Cross-compiles for `linux/arm64` on an x86-64 builder (no QEMU compile); `--target binary` / `--target web` export just the stripped binary or the Admin UI, which the release workflow packs into tarballs. Released as `ghcr.io/thomasmcfarlane/playarr` (see [`docs/deployment/server-releases.md`](../../docs/deployment/server-releases.md)). |
| `docker-compose.dev.yml` | Local dev stack: Postgres 16 + Sonarr/Radarr/Lidarr/Bazarr/Prowlarr/Readarr/Tdarr, plus a real `playarr` service (`PLAYARR_ROLE=all`) built from `backend.Dockerfile`. |
| `docker-compose.ci.yml` | Same dependency stack, tuned for CI (tmpfs instead of named volumes, fast healthchecks), plus a `playarr` service built from `backend.Dockerfile`. |
| `docker-compose.mock.yml` | WireMock stand-ins for the six *arr APIs (`mocks/wiremock/<app>/mappings/*.json`), same service names/ports as `docker-compose.dev.yml`, for fast tests of code that consumes those APIs without booting six real .NET apps. |
| `docker-compose.prod.yml` | Reference multi-node stack: role-split `playarr-api`/`playarr-worker` behind Caddy (`prod/Caddyfile`), Postgres, optional Redis, profile-gated tiers. |
| `docker-compose.watchtower.optional.yml` | Opt-in overlay: label-scoped automatic image updates for `playarr-*` services only. Layer with `-f`; does nothing standalone. |
| `observability/docker-compose.yml` | Optional Prometheus + Grafana overlay. Its own compose project; joins the base stack's `playarr-net` network. |

## Real config contract (verified against `backend/crates/playarr-config/src/lib.rs`)

This directory was originally scaffolded before any backend code existed,
against assumptions borrowed from the Helm chart. Both have since been
reconciled against the real `playarr-config::Config::from_env` and
`backend/src/main.rs`, and two real bugs that drift caused were fixed:
`docker-compose.prod.yml` was passing a `command: ["serve", "--role",
"api"]` override, but `serve` takes no CLI arguments at all -- role
selection is entirely via the `PLAYARR_ROLE` *environment variable*
(fixed: the override now just re-asserts the image's own default `["serve"]`).
`backend.Dockerfile`/`docker-compose.ci.yml` defaulted `PLAYARR_ROLE` to
`standalone`, which `Role::parse` rejects outright (only `all`/`api`/`worker`
are valid) -- the container would have refused to boot as shipped (fixed to
`all`).

- **App HTTP port: `8484`, metrics port: `9090`.** Confirmed as the real
  defaults in `playarr-config::Config::from_env` (`PLAYARR_HTTP_BIND_ADDR`
  defaults to `0.0.0.0:8484`, `PLAYARR_METRICS_BIND_ADDR` to `0.0.0.0:9090`).
  Every compose file's `HTTP_PORT`/`METRICS_PORT` (Dockerfile-local
  convenience vars used only by `HEALTHCHECK`'s curl command, not read by
  the binary) are kept in sync with these by hand -- there's no single
  source of truth deriving one from the other, so if either changes,
  update both.
- **Env var names**: the binary reads `DATABASE_URL`, `REDIS_URL`,
  `PLAYARR_ROLE`, `PLAYARR_LOG`, `PLAYARR_HTTP_BIND_ADDR`,
  `PLAYARR_METRICS_BIND_ADDR`, `PLAYARR_OTLP_ENDPOINT` -- nothing else.
  `PLAYARR_HTTP_BIND_ADDR`/`PLAYARR_METRICS_BIND_ADDR` are full socket
  addresses (`"0.0.0.0:8484"`), not bare port numbers. Earlier drafts of
  these compose files used `APP_ENV`/`LOG_LEVEL`/`LOG_FORMAT`/
  `METRICS_ENABLED`/`HTTP_PORT`/`METRICS_PORT` as if the binary read them
  directly -- it never did; those names are now only used where noted above
  as Dockerfile-local shell convenience, not application config.
- **Health/readiness paths** (`/healthz`, `/readyz`) confirmed real against
  `playarr-api`'s router.
- **CLI shape**: `playarr serve` (no arguments; `serve` is also the
  default when no subcommand is given at all) and `playarr update
  [--check] [--yes] [--channel <stable|beta|nightly>]`, confirmed against
  `backend/src/main.rs`. There is no `--role` flag anywhere.
- **Non-root UID/GID `10001`** and **read-only-root-filesystem-compatible**
  (only `/tmp` is writable; no `/config`/`/data` volume declared) match the
  Helm chart's `podSecurityContext`/`securityContext` and the fact that its
  Deployment templates mount nothing but a `tmp` `emptyDir`. This also
  matches ADR 0001: Tier 2/3 (docker-compose/Kubernetes) use Postgres, so
  there's no local SQLite file requiring a persistent data directory for
  the `playarr` container itself.
- **`*_BASE_URL` env vars** wiring `playarr` to the *arr services in
  `docker-compose.ci.yml` are an outright guess (`playarr-arr-client`'s
  real config schema doesn't exist yet) — flagged inline in that file.
  Reconcile once that crate defines its actual configuration surface.
- **Image repository** `ghcr.io/playarr/playarr` (in `docker-compose.prod.yml`
  and the Watchtower overlay) matches `infra/kubernetes/helm/playarr/values.yaml`'s
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

## Known gaps

1. `playarr-arr-client` is configured via `SourceInstance` database rows
   (added through the API, not env vars) -- `docker-compose.ci.yml`'s
   `*_BASE_URL` env vars aren't read by the binary at all. They're
   currently harmless (no code reads them, so they're not misleading
   anyone into thinking config changed something it didn't) but are also
   not doing anything; remove or replace with a real `SourceInstance`
   seeding step in `scripts/dev-seed.sh` once one exists.
2. `docker-compose.dev.yml` doesn't seed the *arr apps with anything (no
   indexers, no download client, no API keys) or register any
   `SourceInstance` with Playarr Server itself -- that's `scripts/dev-seed.sh`'s
   job per the `Justfile`'s `dev-seed` recipe; nothing currently invokes it
   automatically when the stack comes up.
3. `playarr update --check` (systemd's `playarr-update-check.service`,
   and the same CLI path in a container) is currently a stub in
   `backend/src/main.rs` -- it always reports "up to date," no real network
   call against a release feed exists yet.
