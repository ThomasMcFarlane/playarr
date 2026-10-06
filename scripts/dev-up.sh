#!/usr/bin/env bash
#
# scripts/dev-up.sh
#
# Brings up the Playarr Server local dev stack:
#   1. The dependency containers declared in infra/docker/docker-compose.dev.yml
#      (the *arr suite, wiremock stand-ins, observability, etc.)
#   2. The backend itself, run *natively* via `cargo run` (not containerised)
#      so you get fast incremental rebuilds and a normal debugger attach.
#
# This intentionally does NOT containerise the backend for local dev: the
# whole point of `cargo run` here is edit/save/rerun without a Docker image
# rebuild. Use infra/docker (prod compose) or infra/kubernetes for anything
# that needs the backend containerised.
#
# Usage:
#   ./scripts/dev-up.sh                 # start deps, then run the backend
#   ./scripts/dev-up.sh --deps-only      # start deps, skip cargo run
#   ./scripts/dev-up.sh --no-deps        # skip docker compose, just cargo run
#   ./scripts/dev-up.sh --release        # cargo run --release
#   ./scripts/dev-up.sh -- --role api    # everything after `--` goes to the binary
#
# Env overrides:
#   COMPOSE_FILE        path to the dev compose file
#                        (default: infra/docker/docker-compose.dev.yml)
#   COMPOSE_PROJECT_NAME docker compose project name (default: playarr-dev)
#   BACKEND_MANIFEST    path to the backend workspace Cargo.toml
#                        (default: backend/Cargo.toml)
#   BACKEND_BIN         cargo bin target to run (default: playarr)
#   SKIP_COMPOSE_WAIT   set to 1 to skip `--wait` on `docker compose up`
#                        (useful if your compose file has no/incomplete
#                        healthchecks yet and `--wait` would just time out)
#
# NOTE: this script is authored as scaffolding and is NOT executed as part
# of building this repo. Do not run it until infra/docker/docker-compose.dev.yml
# exists and backend/src/main.rs is buildable.

set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve paths relative to the repo root regardless of the caller's cwd.
# This matters in particular for `cargo run --manifest-path`: cargo does NOT
# chdir into the manifest's directory before executing the built binary, it
# keeps whatever cwd the shell had. Pinning cwd to the repo root here means
# any relative paths the backend resolves (config files under backend/config,
# migrations under backend/migrations, etc.) behave the same no matter where
# you invoked this script from.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/infra/docker/docker-compose.dev.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-playarr-dev}"
BACKEND_MANIFEST="${BACKEND_MANIFEST:-${REPO_ROOT}/backend/Cargo.toml}"
BACKEND_BIN="${BACKEND_BIN:-playarr}"
SKIP_COMPOSE_WAIT="${SKIP_COMPOSE_WAIT:-0}"

RUN_DEPS=1
RUN_BACKEND=1
CARGO_PROFILE_FLAG=()
BACKEND_ARGS=()

usage() {
  grep -E '^#( |$)' "${BASH_SOURCE[0]}" | sed -E 's/^# ?//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deps-only)
      RUN_BACKEND=0
      shift
      ;;
    --no-deps)
      RUN_DEPS=0
      shift
      ;;
    --release)
      CARGO_PROFILE_FLAG=(--release)
      shift
      ;;
    -h|--help)
      usage 0
      ;;
    --)
      shift
      BACKEND_ARGS=("$@")
      break
      ;;
    *)
      echo "dev-up.sh: unknown argument: $1" >&2
      usage 1
      ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "dev-up.sh: required command '$1' not found on PATH" >&2
    exit 1
  fi
}

if [[ "${RUN_DEPS}" -eq 1 ]]; then
  require_cmd docker

  if [[ ! -f "${COMPOSE_FILE}" ]]; then
    echo "dev-up.sh: compose file not found: ${COMPOSE_FILE}" >&2
    echo "           (expected infra/docker/docker-compose.dev.yml -- has infra/docker landed yet?)" >&2
    exit 1
  fi

  echo "==> Starting dependency stack from ${COMPOSE_FILE} (project: ${COMPOSE_PROJECT_NAME})"

  compose_up_args=(-f "${COMPOSE_FILE}" -p "${COMPOSE_PROJECT_NAME}" up -d)
  if [[ "${SKIP_COMPOSE_WAIT}" -ne 1 ]]; then
    # `--wait` blocks until every service with a healthcheck reports healthy
    # (or exits non-zero on failure/timeout). Falls back gracefully to "up
    # and running" semantics for services with no healthcheck defined.
    compose_up_args+=(--wait)
  fi

  docker compose "${compose_up_args[@]}"

  echo "==> Dependency stack is up. Services:"
  docker compose -f "${COMPOSE_FILE}" -p "${COMPOSE_PROJECT_NAME}" ps
else
  echo "==> Skipping dependency stack (--no-deps)"
fi

if [[ "${RUN_BACKEND}" -eq 1 ]]; then
  require_cmd cargo

  if [[ ! -f "${BACKEND_MANIFEST}" ]]; then
    echo "dev-up.sh: backend manifest not found: ${BACKEND_MANIFEST}" >&2
    exit 1
  fi

  echo "==> Starting backend natively: cargo run --manifest-path ${BACKEND_MANIFEST} --bin ${BACKEND_BIN}"

  # Runs in the foreground and takes over this shell/terminal on purpose --
  # dev-up.sh is meant to be the thing you leave running in a dedicated pane
  # while you work, the same way `docker compose up` (no -d) would be.
  exec cargo run \
    --manifest-path "${BACKEND_MANIFEST}" \
    --bin "${BACKEND_BIN}" \
    "${CARGO_PROFILE_FLAG[@]}" \
    -- "${BACKEND_ARGS[@]}"
else
  echo "==> Skipping backend (--deps-only). Dependency stack left running in the background."
fi
