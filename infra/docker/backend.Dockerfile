# No `# syntax=` line on purpose: it makes BuildKit pull the docker/dockerfile frontend image from Docker Hub
# on every build (a Docker Hub auth 504 failed CI, 1.9931). Nothing here needs a 1.7-only feature, so the
# builder's built-in Dockerfile frontend is used.
#
# ==============================================================================
# Playarr Server backend image -- multi-stage Rust build
#
# Builds the single `playarr-server` binary (backend/Cargo.toml workspace, package
# `playarr-bin`, `[[bin]] name = "playarr-server"`) into a slim, non-root
# runtime image. Per docs/architecture/overview.md ("the single-role-gated-
# binary principle"), this is the ONLY binary Playarr Server ships: the same
# image runs role `all`, `api`, or `worker` depending on the PLAYARR_ROLE
# *environment variable* -- `serve` itself takes no CLI arguments (see
# backend/src/main.rs) -- which is what lets docker-compose.ci.yml,
# docker-compose.prod.yml, and the Helm chart under infra/kubernetes/ all
# deploy from one artifact.
#
# This image also co-hosts Playarr Admin's built static assets
# (stage `web-builder` below, copied to /app/web in the runtime stage) --
# `playarr-server` serves both the API and the UI on one origin/port, same as
# every `*arr` app ships its own UI, rather than requiring a separately
# hosted web client pointed at this API over CORS. The binary remains the
# one artifact that matters (the assets are inert static files it serves,
# not a second process), so this doesn't change the single-binary principle
# above; see `playarr_api::build_router`'s `web_assets_dir` doc comment
# and `backend/src/main.rs`'s `web_assets_dir_from_env`.
#
# Build context MUST be the repository root (so both `backend/` and
# `clients/tv-web/` are reachable), e.g.:
#
#   docker build -f infra/docker/backend.Dockerfile -t playarr:dev .
#
# Every docker-compose*.yml in this directory that builds this image sets
# `build.context: ../..` and `build.dockerfile: infra/docker/backend.Dockerfile`
# accordingly -- do not change this Dockerfile to assume a different context
# without updating every compose file that references it.
#
# Env contract is the real one playarr-config::Config::from_env reads
# (see backend/crates/playarr-config/src/lib.rs): DATABASE_URL (a `sqlite:` URL),
# PLAYARR_ROLE, PLAYARR_LOG, PLAYARR_HTTP_BIND_ADDR,
# PLAYARR_METRICS_BIND_ADDR, PLAYARR_OTLP_ENDPOINT -- the same names
# whether started by `docker run`, docker-compose, or a Kubernetes Pod. See
# infra/docker/README.md for the full rationale. PLAYARR_WEB_ASSETS_DIR
# (see `web_assets_dir_from_env`) only needs setting to override where this
# image already places the built Admin UI (/app/web) -- not part of that core
# contract, and left unset in this image's own compose/Helm config.
# ==============================================================================

ARG RUST_VERSION=1
# Where the runtime stage takes the server binary and Admin UI from:
#   built-artifacts     (default) compiled by the `builder` and `web-builder` stages below;
#   prebuilt-artifacts  taken from the named build context `prebuilt`
#                       (`--build-context prebuilt=<dir>`, laid out as
#                       <dir>/<amd64|arm64>/playarr-server and <dir>/web/web, exactly what
#                       the `binary` and `web` export stages write). The release workflow
#                       uses this so the image carries the tarball's binaries and the
#                       multi-arch image step never compiles a second time (no disk spike).
ARG ARTIFACTS=built-artifacts
# Image for the web-builder stage. CI overrides it with a digest-pinned mirror.gcr.io reference
# (--build-arg NODE_IMAGE=...) so the build does not depend on Docker Hub being up.
ARG NODE_IMAGE=node:23-slim
# trixie, not bookworm: the prebuilt ONNX Runtime that ort-sys links is built
# with a newer libstdc++ (GCC 13+) than bookworm's GCC 12 provides, so the
# final link fails with undefined `std::__cxx11::basic_string::_M_replace_cold`.
ARG DEBIAN_CODENAME=trixie

# ------------------------------------------------------------------------
# Stage 1: chef -- base image with cargo-chef installed once, reused by
# both the planner and builder stages below so its own compile is cached.
# ------------------------------------------------------------------------
#
# The whole Rust build runs on the *build* platform and cross-compiles to the
# requested target (`docker buildx build --platform linux/arm64` compiles
# natively on an x86-64 builder with the aarch64 GNU cross toolchain instead of
# emulating the compiler under QEMU, which is many times slower). Only the
# tiny runtime stage below ever executes under emulation.
FROM --platform=$BUILDPLATFORM rust:${RUST_VERSION}-slim-${DEBIAN_CODENAME} AS chef
ARG TARGETARCH
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      pkg-config \
      libssl-dev \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Cross toolchain (only when the target architecture differs from the build
# host) plus the Rust target and a cargo config that points at it. For a
# same-architecture build nothing extra is installed and cargo is untouched.
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) triple=x86_64-unknown-linux-gnu;  gnu=x86_64-linux-gnu;  pkgs="gcc-x86-64-linux-gnu g++-x86-64-linux-gnu libc6-dev-amd64-cross" ;; \
      arm64) triple=aarch64-unknown-linux-gnu; gnu=aarch64-linux-gnu; pkgs="gcc-aarch64-linux-gnu g++-aarch64-linux-gnu libc6-dev-arm64-cross" ;; \
      *) echo "unsupported TARGETARCH ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    echo "$triple" > /rust-target; \
    rustup target add "$triple"; \
    if [ "$(dpkg --print-architecture)" != "${TARGETARCH:-amd64}" ]; then \
      dpkg --add-architecture "${TARGETARCH}"; \
      apt-get update && apt-get install -y --no-install-recommends $pkgs "libssl-dev:${TARGETARCH}" \
      && rm -rf /var/lib/apt/lists/*; \
      us="$(echo $triple | tr - _)"; \
      printf '#!/bin/sh\nPKG_CONFIG_LIBDIR=/usr/lib/%s/pkgconfig:/usr/share/pkgconfig exec pkg-config "$@"\n' "$gnu" \
        > "/usr/local/bin/$gnu-pkg-config"; \
      chmod +x "/usr/local/bin/$gnu-pkg-config"; \
      mkdir -p /usr/local/cargo; \
      printf '[target.%s]\nlinker = "%s-gcc"\n[env]\nCC_%s = "%s-gcc"\nCXX_%s = "%s-g++"\nAR_%s = "%s-ar"\nPKG_CONFIG_%s = "/usr/local/bin/%s-pkg-config"\n' \
        "$triple" "$gnu" "$us" "$gnu" "$us" "$gnu" "$us" "$gnu" "$us" "$gnu" \
        >> /usr/local/cargo/config.toml; \
      echo "$gnu" > /strip-prefix; \
    else \
      echo "" > /strip-prefix; \
    fi
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
# `playarr-db` compiles in the SQLite driver (libsqlite3-sys, needs a C
# toolchain -- see build-essential above). Playarr is SQLite-only (ADR 0002),
# so there is exactly one release artifact.
# ------------------------------------------------------------------------
FROM chef AS builder
WORKDIR /build/backend
COPY --from=planner /build/backend/recipe.json ./recipe.json
RUN cargo chef cook --release --target "$(cat /rust-target)" --recipe-path recipe.json
COPY backend/ ./
RUN set -eux; \
    triple="$(cat /rust-target)"; prefix="$(cat /strip-prefix)"; \
    cargo build --release --workspace --locked --target "$triple" --bin playarr-server; \
    mkdir -p /build/out; \
    cp "target/$triple/release/playarr-server" /build/out/playarr-server; \
    "${prefix:+$prefix-}strip" /build/out/playarr-server

# ------------------------------------------------------------------------
# Stage: web-builder -- builds Playarr Admin's static assets
# (clients/tv-web/admin/dist), so the runtime stage can co-host the UI on
# the same origin/port as the API (see the header comment above). Only
# `@playarr-tv/admin` and its actual workspace dependencies are built
# (pnpm's `...` filter suffix) -- NOT `pnpm -r`, which would also try to
# build the TV app shells (apps/tv-webos, apps/tv-tizen) and their
# packaging steps (`ares-package`, Tizen Studio CLI) that this generic
# Node image has no business trying to run. Independent of the Rust chef/
# planner/builder stages above -- BuildKit runs this concurrently with
# them, not after.
# ------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS web-builder
WORKDIR /build
RUN corepack enable && corepack prepare pnpm@11.13.0 --activate
COPY clients/tv-web/ ./clients/tv-web/
WORKDIR /build/clients/tv-web
RUN pnpm install --frozen-lockfile
# Every shared library under packages/ points its entry (`main`/`types`) at dist/, which only
# exists after its own `build`. `pnpm --filter <app>... run build:server` runs ONLY the app's
# script (the libraries have no `build:server`), so build all of packages/ first, generically:
# a library added later is picked up with no edit here. `tsc` in the app steps below resolves
# the libraries through those dist/ outputs.
RUN pnpm --filter "./packages/**" run build
RUN pnpm --filter @playarr-tv/admin... run build
# The web client built for hosting by the server itself under /tv/ (`vite --mode server`,
# base "/tv/"): lets a TV whose browser can only reach an http:// server (VIDAA) load the
# app over the same scheme, with no mixed content. Shipped inside the web dir as web/tv/.
RUN pnpm --filter @playarr-tv/web... run build:server

# ------------------------------------------------------------------------
# Export-only stages. `docker buildx build --target binary --platform
# linux/arm64 -o type=local,dest=out .` writes just the stripped server binary
# (and `--target web` just the Admin UI) to `out/`; the release workflow packs
# these into the bare-metal tarballs so the tarball binary is byte-identical to
# the one inside the container image.
# ------------------------------------------------------------------------
FROM scratch AS binary
COPY --from=builder /build/out/playarr-server /playarr-server

FROM scratch AS web
COPY --from=web-builder /build/clients/tv-web/admin/dist/ /web/
COPY --from=web-builder /build/clients/tv-web/web/dist-server/ /web/tv/

FROM scratch AS built-artifacts
COPY --from=builder /build/out/playarr-server /playarr-server
COPY --from=web-builder /build/clients/tv-web/admin/dist/ /web/
COPY --from=web-builder /build/clients/tv-web/web/dist-server/ /web/tv/

FROM scratch AS prebuilt-artifacts
ARG TARGETARCH
COPY --from=prebuilt ${TARGETARCH}/playarr-server /playarr-server
COPY --from=prebuilt web/web/ /web/

FROM ${ARTIFACTS} AS artifacts

# ------------------------------------------------------------------------
# Stage 4: runtime -- minimal Debian base, non-root, read-only-root-
# filesystem friendly. /data is writable (owned by the playarr user) for
# SQLite (DATABASE_URL=sqlite:///data/playarr.db) -- mount a named volume
# there so the database survives container restarts (see
# docker-compose.standalone.yml). Multi-node deployments run one such
# container per node and use peer sync.
# ------------------------------------------------------------------------
FROM debian:${DEBIAN_CODENAME}-slim AS runtime

# curl is installed deliberately (not "stripped for size") because it is
# what HEALTHCHECK below uses to hit the binary's own /healthz endpoint --
# see docs/architecture/overview.md for the axum-based playarr-api
# surface this probes.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      ffmpeg \
      tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 playarr \
    && useradd --system --uid 10001 --gid playarr --home-dir /app --shell /usr/sbin/nologin playarr \
    && mkdir -p /app /data/playarr-cache/artwork \
    && chown -R playarr:playarr /app /data

# --------------------------------------------------------------------
# Self-update-refusal marker.
#
# Playarr Server's `playarr-server update` subcommand (docs/architecture/overview.md,
# "playarr-cli" row) can self-replace the running binary on bare-metal /
# systemd (Tier 1) installs. Inside a container, that is actively wrong:
# the image tag *is* the version, and the correct update path is
# `docker pull` + recreate (or a Watchtower-style rollout -- see
# docker-compose.watchtower.optional.yml), never an in-place binary swap
# that a subsequent `docker pull` would silently discard anyway.
#
# The presence of this file is how `playarr-server update` distinguishes "I am
# running inside an official container image" from a bare-metal/systemd
# install, and MUST refuse to self-update (printing guidance to use the
# image/tag lifecycle instead) whenever it exists. It is owned by root and
# not writable by the `playarr` user, so the running process cannot
# remove it to bypass the check.
# --------------------------------------------------------------------
RUN touch /.playarr-container && chmod 0444 /.playarr-container

COPY --from=artifacts --chown=playarr:playarr /playarr-server /app/playarr-server
COPY --from=artifacts --chown=playarr:playarr /web/ /app/web/

WORKDIR /app
USER playarr:playarr

# Non-secret runtime config. These are the actual env vars
# playarr-config::Config::from_env reads (verified against
# backend/crates/playarr-config/src/lib.rs) -- not a set of
# conveniently-named vars the binary silently ignores. DATABASE_URL is
# intentionally NOT set here -- it is
# deployment-specific and always supplied by the caller (docker-compose
# environment/.env, a Kubernetes Secret, etc.), never baked into the image.
#
# HTTP_PORT/METRICS_PORT below are a Dockerfile-local convenience only (used
# by HEALTHCHECK's curl command), not read by the binary itself -- keep
# them in sync with the port numbers embedded in
# PLAYARR_HTTP_BIND_ADDR/PLAYARR_METRICS_BIND_ADDR if either changes.
ENV PLAYARR_ROLE=all \
    PLAYARR_LOG=info \
    PLAYARR_HTTP_BIND_ADDR=0.0.0.0:8484 \
    PLAYARR_METRICS_BIND_ADDR=0.0.0.0:9090 \
    HTTP_PORT=8484 \
    METRICS_PORT=9090 \
    RUST_BACKTRACE=0

EXPOSE 8484
EXPOSE 9090

ENTRYPOINT ["/usr/bin/tini", "--"]
# `Role::All` runs both the API router and the worker background loops in
# one process -- the right default for a single `docker run`. Compose files
# override the PLAYARR_ROLE *environment variable* (never a CLI flag --
# `serve` takes none, see `backend/src/main.rs`) to `api`/`worker` for
# split-role deployments; `command:` stays `["/app/playarr-server", "serve"]`
# unchanged in every case.
CMD ["/app/playarr-server", "serve"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail --silent --show-error "http://127.0.0.1:${HTTP_PORT}/healthz" || exit 1

LABEL org.opencontainers.image.title="playarr" \
      org.opencontainers.image.description="Playarr Server media server backend (API + worker + coordinator roles, single binary)" \
      org.opencontainers.image.source="https://github.com/ThomasMcFarlane/playarr" \
      org.opencontainers.image.licenses="MIT"
