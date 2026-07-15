# syntax=docker/dockerfile:1.7
#
# ==============================================================================
# Streamarr backend image -- multi-stage Rust build
#
# Builds the single `streamarr` binary (backend/Cargo.toml workspace, package
# `streamarr-bin`, `[[bin]] name = "streamarr"`) into a slim, non-root
# runtime image. Per docs/architecture/overview.md ("the single-role-gated-
# binary principle"), this is the ONLY binary Streamarr ships: the same
# image runs standalone, `--role api`, or `--role worker` depending on the
# `serve` subcommand's arguments, which is what lets docker-compose.ci.yml,
# docker-compose.prod.yml, and the Helm chart under infra/kubernetes/ all
# deploy from one artifact.
#
# Build context MUST be the repository root (so `backend/` is reachable),
# e.g.:
#
#   docker build -f infra/docker/backend.Dockerfile -t streamarr:dev .
#
# Every docker-compose*.yml in this directory that builds this image sets
# `build.context: ../..` and `build.dockerfile: infra/docker/backend.Dockerfile`
# accordingly -- do not change this Dockerfile to assume a different context
# without updating every compose file that references it.
#
# Port/env contract mirrors infra/kubernetes/helm/streamarr/values.yaml
# (ConfigMap keys APP_ENV/LOG_LEVEL/LOG_FORMAT/METRICS_ENABLED/METRICS_PORT/
# HTTP_PORT and the STREAMARR_ROLE env var) so the same container behaves
# identically whether it is started by `docker run`, docker-compose, or a
# Kubernetes Pod. See infra/docker/README.md for the full rationale.
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
# Stage 4: runtime -- minimal Debian base, non-root, read-only-root-
# filesystem friendly (the only writable path the binary needs is /tmp;
# state lives in Postgres/Redis per ADR 0001's Tier 2/3 design, so no
# /data or /config volume is declared here -- see infra/docker/README.md).
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
    && mkdir -p /app \
    && chown -R streamarr:streamarr /app

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

WORKDIR /app
USER streamarr:streamarr

# Non-secret runtime config. Keys deliberately match
# infra/kubernetes/helm/streamarr/values.yaml's `config:` ConfigMap block
# so the same env var names work whether Streamarr is started by
# docker-compose or a Kubernetes Deployment. DATABASE_URL and (optionally)
# REDIS_URL are intentionally NOT set here -- they are secret-shaped and
# always supplied by the caller (docker-compose environment/.env, a
# Kubernetes Secret, etc.), never baked into the image.
ENV APP_ENV=production \
    LOG_LEVEL=info \
    LOG_FORMAT=json \
    METRICS_ENABLED=true \
    METRICS_PORT=9090 \
    HTTP_PORT=8080 \
    STREAMARR_ROLE=standalone \
    RUST_BACKTRACE=0

EXPOSE 8080
EXPOSE 9090

ENTRYPOINT ["/usr/bin/tini", "--"]
# `serve` with no --role resolves to the STANDALONE role set (API + worker
# + coordinator no-op) per docs/architecture/overview.md -- the right
# default for a single `docker run`. Compose files override `command:` to
# pass `--role api` / `--role worker` for split-role deployments.
CMD ["/app/streamarr", "serve"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail --silent --show-error "http://127.0.0.1:${HTTP_PORT}/healthz" || exit 1

LABEL org.opencontainers.image.title="streamarr" \
      org.opencontainers.image.description="Streamarr media server backend (API + worker + coordinator roles, single binary)" \
      org.opencontainers.image.source="https://github.com/streamarr/streamarr" \
      org.opencontainers.image.licenses="MIT"
