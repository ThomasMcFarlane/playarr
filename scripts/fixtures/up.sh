#!/usr/bin/env bash
# Brings up the fixture environment: fixture media, a Sonarr/Radarr/Dubarr stub,
# a local Playarr server on loopback and the seeded fixture users.
#
#   scripts/fixtures/up.sh            # idempotent
#   scripts/fixtures/up.sh --fresh    # wipe the database first
#
# Env: PLAYARR_FIXTURE_DIR, PLAYARR_FIXTURE_PORT (18484), PLAYARR_FIXTURE_BIND,
#      PLAYARR_SERVER_BIN (skip the cargo build), PLAYARR_FIXTURE_NO_BUILD=1,
#      PLAYARR_WEB_ASSETS_DIR (also serve a built web client),
#      PLAYARR_FIXTURE_CLIP_SECONDS (length of each generated clip, default 6),
#      FIXTURE_CHILD_WINDOW="start-end" (child schedule, minutes of day UTC).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

for c in node curl ffmpeg ffprobe; do
  command -v "$c" >/dev/null || { echo "up.sh: '$c' is required" >&2; exit 1; }
done

if [[ "${1:-}" == "--fresh" ]]; then
  "${FIX_SCRIPT_DIR}/down.sh" >/dev/null 2>&1 || true
  rm -rf "${FIX_DATA_DIR}"
fi
mkdir -p "${FIX_MEDIA_DIR}" "${FIX_DATA_DIR}" "${FIX_LOG_DIR}" "${FIX_RUN_DIR}"

alive() { [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null; }

# 1. Server binary.
BIN="${PLAYARR_SERVER_BIN:-}"
if [[ -z "${BIN}" ]]; then
  if [[ -z "${PLAYARR_FIXTURE_NO_BUILD:-}" ]]; then
    echo "==> building playarr-server (set PLAYARR_SERVER_BIN to skip)"
    (cd "${FIX_REPO_ROOT}/backend" && cargo build --bin playarr-server >&2)
  fi
  TARGET="$(cd "${FIX_REPO_ROOT}/backend" && cargo metadata --format-version 1 --no-deps | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).target_directory))')"
  BIN="${TARGET}/debug/playarr-server"
fi
[[ -x "${BIN}" ]] || { echo "up.sh: server binary not found: ${BIN}" >&2; exit 1; }

# 2. Media.
echo "==> generating fixture media"
node "${FIX_SCRIPT_DIR}/media.mjs" "${FIX_MEDIA_DIR}"

# 3. Stub Sonarr/Radarr/Dubarr.
if ! alive "${FIX_RUN_DIR}/stub.pid"; then
  echo "==> starting source stub on 127.0.0.1:${FIX_STUB_PORT}"
  nohup node "${FIX_SCRIPT_DIR}/stub.mjs" "${FIX_MEDIA_DIR}" "${FIX_STUB_PORT}" "${FIX_STUB_KEY}" \
    >"${FIX_LOG_DIR}/stub.log" 2>&1 &
  echo $! >"${FIX_RUN_DIR}/stub.pid"
fi

# 4. Server.
if ! alive "${FIX_RUN_DIR}/server.pid"; then
  echo "==> starting playarr-server on ${FIX_BIND}:${FIX_PORT}"
  # shellcheck disable=SC2155
  export DATABASE_URL="sqlite://${FIX_DATA_DIR}/playarr.db?mode=rwc"
  export PLAYARR_HTTP_BIND_ADDR="${FIX_BIND}:${FIX_PORT}"
  export PLAYARR_METRICS_BIND_ADDR="127.0.0.1:${FIX_METRICS_PORT}"
  export PLAYARR_JWT_SECRET="${FIX_JWT_SECRET}"
  export PLAYARR_AUTH_MODE=full-account
  export PLAYARR_BOOTSTRAP_ADMIN_USERNAME=fx-admin
  export PLAYARR_BOOTSTRAP_ADMIN_PASSWORD="$(node -e 'import("'"${FIX_SCRIPT_DIR}"'/catalog.mjs").then(m=>console.log(m.FIXTURE_PASSWORD))')"
  export PLAYARR_ARTWORK_CACHE_DIR="${FIX_DATA_DIR}/artwork"
  export PLAYARR_LOG="${PLAYARR_LOG:-info}"
  nohup "${BIN}" >"${FIX_LOG_DIR}/server.log" 2>&1 &
  echo $! >"${FIX_RUN_DIR}/server.pid"
fi

echo -n "==> waiting for the server"
for _ in $(seq 1 90); do
  curl -fsS "${FIX_URL}/healthz" >/dev/null 2>&1 && break
  alive "${FIX_RUN_DIR}/server.pid" || { echo; echo "server exited; see ${FIX_LOG_DIR}/server.log" >&2; exit 1; }
  echo -n .; sleep 1
done
echo

# 5. Seed users, household policies, sources; wait for the first sync.
node "${FIX_SCRIPT_DIR}/seed.mjs" "${FIX_URL}" "http://127.0.0.1:${FIX_STUB_PORT}" "${FIX_STUB_KEY}"

echo
echo "Fixture server: ${FIX_URL}   (emulator: http://10.0.2.2:${FIX_PORT})"
echo "Users (password in scripts/fixtures/catalog.mjs): fx-admin fx-viewer fx-guardian fx-child fx-child-locked"
echo "Verify: node scripts/fixtures/verify.mjs   Stop: scripts/fixtures/down.sh"
