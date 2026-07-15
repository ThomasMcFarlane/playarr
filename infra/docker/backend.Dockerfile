# syntax=docker/dockerfile:1.7
#
# ==============================================================================
# Streamarr backend image -- multi-stage Rust build
#
# Builds the single `streamarr` binary (backend/Cargo.toml workspace, package
# `streamarr-bin`, `[[bin]] name = "streamarr"`) into a slim, non-root
# runtime image. Per docs/architecture/overview.md ("the single-role-gated-
# binary principle"), this is the ONLY binary Streamarr ships: the same
# image runs role `all`, `api`, or `worker` depending on the STREAMARR_ROLE
# *environment variable* -- `serve` itself takes no CLI arguments (see
# backend/src/main.rs) -- which is what lets docker-compose.ci.yml,
# docker-compose.prod.yml, and the Helm chart under infra/kubernetes/ all
# deploy from one artifact.
#
# This image also co-hosts the standalone Web app's built static assets
# (stage `web-builder` below, copied to /app/web in the runtime stage) --
# `streamarr` serves both the API and the UI on one origin/port, same as
# every `*arr` app ships its own UI, rather than requiring a separately
# hosted web client pointed at this API over CORS. The binary remains the
# one artifact that matters (the assets are inert static files it serves,
# not a second process), so this doesn't change the single-binary principle
# above; see `streamarr_api::build_router`'s `web_assets_dir` doc comment
# and `backend/src/main.rs`'s `web_assets_dir_from_env`.
#
# Build context MUST be the repository root (so both `backend/` and
# `clients/tv-web/` are reachable), e.g.:
#
#   docker build -f infra/docker/backend.Dockerfile -t streamarr:dev .
#
# Every docker-compose*.yml in this directory that builds this image sets
# `build.context: ../..` and `build.dockerfile: infra/docker/backend.Dockerfile`
# accordingly -- do not change this Dockerfile to assume a different context
# without updating every compose file that references it.
#
# Env contract is the real one streamarr-config::Config::from_env reads
# (see backend/crates/streamarr-config/src/lib.rs): DATABASE_URL, REDIS_URL,
# STREAMARR_ROLE, STREAMARR_LOG, STREAMARR_HTTP_BIND_ADDR,
# STREAMARR_METRICS_BIND_ADDR, STREAMARR_OTLP_ENDPOINT -- the same names
# whether started by `docker run`, docker-compose, or a Kubernetes Pod. See
# infra/docker/README.md for the full rationale. STREAMARR_WEB_ASSETS_DIR
# (see `web_assets_dir_from_env`) only needs setting to override where this
# image already places the built Web UI (/app/web) -- not part of that core
# contract, and left unset in this image's own compose/Helm config.
# ==============================================================================

ARG RUST_VERSION=1
ARG DEBIAN_CODENAME=bookworm

# ------------------------------------------------------------------------
# Stage 1: chef -- base image with cargo-chef installed once, reused by
# both the planner and builder stages below so its own compile is cached.
# ------------------------------------------------------------------------
FROM rust:${RUST_VERSION}-slim-${DEBIAN_CODENAME} AS chef
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      pkg-config \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN cargo install cargo-chef --locked

# ------------------------------------------------------------------------
# Stage 2: planner -- compute a dependency "recipe" from the workspace
# manifests only, so stage 3's dependency-build layer cache is invalidated
# only when a Cargo.toml/Cargo.lock actually changes, not on every source
# edit.
# ------------------------------------------------------------------------
FROM chef AS planner
COPY backend/ ./backend/
WORKDIR /build/backend
RUN cargo chef prepare --recipe-path recipe.json

# ------------------------------------------------------------------------
# Stage 3: builder -- cook (build + cache) dependencies from the recipe,
# then copy the real sources and compile the workspace in release mode.
# `streamarr-db` compiles in both the `sqlite` (libsqlite3-sys, needs a C
# toolchain -- see build-essential above) and `postgres` (pure-Rust wire
# protocol) drivers into every binary per ADR 0001 -- backend selection is
# a runtime config value, not a build feature, so there is exactly one
# release artifact regardless of which backend a deployment tier uses.
# ------------------------------------------------------------------------
FROM chef AS builder
WORKDIR /build/backend
COPY --from=planner /build/backend/recipe.json ./recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY backend/ ./
RUN cargo build --release --workspace --locked --bin streamarr \
    && mkdir -p /build/out \
    && cp target/release/streamarr /build/out/streamarr \
    && strip /build/out/streamarr

# ------------------------------------------------------------------------
# Stage: web-builder -- builds the standalone Web app's static assets
# (clients/tv-web/web/dist), so the runtime stage can co-host the UI on
# the same origin/port as the API (see the header comment above). Only
# `@streamarr-tv/web` and its actual workspace dependencies are built
# (pnpm's `...` filter suffix) -- NOT `pnpm -r`, which would also try to
# build the TV app shells (apps/tv-webos, apps/tv-tizen) and their
# packaging steps (`ares-package`, Tizen Studio CLI) that this generic
# Node image has no business trying to run. Independent of the Rust chef/
# planner/builder stages above -- BuildKit runs this concurrently with
# them, not after.
# ------------------------------------------------------------------------
FROM node:20-slim AS web-builder
WORKDIR /build
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY clients/tv-web/ ./clients/tv-web/
WORKDIR /build/clients/tv-web
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @streamarr-tv/web... run build

# ------------------------------------------------------------------------
# Stage 4: runtime -- minimal Debian base, non-root, read-only-root-
# filesystem friendly. /data is writable (owned by the streamarr user) for
# the SQLite tier (DATABASE_URL=sqlite:///data/streamarr.db) -- mount a
# named volume there for a genuinely containerized Tier 1 experience (see
# docker-compose.standalone.yml). Postgres/Redis-backed Tier 2/3
# deployments don't need it and can leave the mount point empty.
# ------------------------------------------------------------------------
FROM debian:${DEBIAN_CODENAME}-slim AS runtime

# curl is installed deliberately (not "stripped for size") because it is
# what HEALTHCHECK below uses to hit the binary's own /healthz endpoint --
# see docs/architecture/overview.md for the axum-based streamarr-api
# surface this probes.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 streamarr \
    && useradd --system --uid 10001 --gid streamarr --home-dir /app --shell /usr/sbin/nologin streamarr \
    && mkdir -p /app /data \
    && chown -R streamarr:streamarr /app /data

# --------------------------------------------------------------------
# Self-update-refusal marker.
#
# Streamarr's `streamarr update` subcommand (docs/architecture/overview.md,
# "streamarr-cli" row) can self-replace the running binary on bare-metal /
# systemd (Tier 1) installs. Inside a container, that is actively wrong:
# the image tag *is* the version, and the correct update path is
# `docker pull` + recreate (or a Watchtower-style rollout -- see
# docker-compose.watchtower.optional.yml), never an in-place binary swap
# that a subsequent `docker pull` would silently discard anyway.
#
# The presence of this file is how `streamarr update` distinguishes "I am
# running inside an official container image" from a bare-metal/systemd
# install, and MUST refuse to self-update (printing guidance to use the
# image/tag lifecycle instead) whenever it exists. It is owned by root and
# not writable by the `streamarr` user, so the running process cannot
# remove it to bypass the check.
# --------------------------------------------------------------------
RUN touch /.streamarr-container && chmod 0444 /.streamarr-container

COPY --from=builder --chown=streamarr:streamarr /build/out/streamarr /app/streamarr
COPY --from=web-builder --chown=streamarr:streamarr /build/clients/tv-web/web/dist /app/web

WORKDIR /app
USER streamarr:streamarr

# Non-secret runtime config. These are the actual env vars
# streamarr-config::Config::from_env reads (verified against
# backend/crates/streamarr-config/src/lib.rs) -- not a set of
# conveniently-named vars the binary silently ignores. DATABASE_URL and
# (optionally) REDIS_URL are intentionally NOT set here -- they are
# secret-shaped and always supplied by the caller (docker-compose
# environment/.env, a Kubernetes Secret, etc.), never baked into the image.
#
# HTTP_PORT/METRICS_PORT below are a Dockerfile-local convenience only (used
# by HEALTHCHECK's curl command), not read by the binary itself -- keep
# them in sync with the port numbers embedded in
# STREAMARR_HTTP_BIND_ADDR/STREAMARR_METRICS_BIND_ADDR if either changes.
ENV STREAMARR_ROLE=all \
    STREAMARR_LOG=info \
    STREAMARR_HTTP_BIND_ADDR=0.0.0.0:8080 \
    STREAMARR_METRICS_BIND_ADDR=0.0.0.0:9090 \
    HTTP_PORT=8080 \
    METRICS_PORT=9090 \
    RUST_BACKTRACE=0

EXPOSE 8080
EXPOSE 9090

ENTRYPOINT ["/usr/bin/tini", "--"]
# `Role::All` runs both the API router and the worker background loops in
# one process -- the right default for a single `docker run`. Compose files
# override the STREAMARR_ROLE *environment variable* (never a CLI flag --
# `serve` takes none, see `backend/src/main.rs`) to `api`/`worker` for
# split-role deployments; `command:` stays `["/app/streamarr", "serve"]`
# unchanged in every case.
CMD ["/app/streamarr", "serve"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail --silent --show-error "http://127.0.0.1:${HTTP_PORT}/healthz" || exit 1

LABEL org.opencontainers.image.title="streamarr" \
      org.opencontainers.image.description="Streamarr media server backend (API + worker + coordinator roles, single binary)" \
      org.opencontainers.image.source="https://github.com/streamarr/streamarr" \
      org.opencontainers.image.licenses="MIT"
