#!/usr/bin/env bash
# Brings up the public showcase: Radarr/Sonarr stand-ins serving the open-movie catalogue, a local Playarr
# server on loopback, and the "demo" profile with a preset avatar. Separate from scripts/fixtures.
#
#   scripts/showcase/up.sh            # idempotent
#   scripts/showcase/up.sh --fresh    # wipe the database first
#
# Env: PLAYARR_SHOWCASE_DIR, PLAYARR_SHOWCASE_MEDIA (see lib.sh), PLAYARR_SHOWCASE_PORT (18810; uses +0..+4),
#      PLAYARR_SERVER_BIN (required unless cargo builds it), PLAYARR_WEB_ASSETS_DIR (built admin client).
# Needs: node, curl, python3, sqlite3, ffprobe. Run it inside a systemd-run memory scope.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
[[ "${1:-}" == "--fresh" ]] && { "${SC_SCRIPT_DIR}/down.sh" >/dev/null 2>&1 || true; rm -rf "${SC_DATA}"; }
mkdir -p "${SC_RUN}" "${SC_LOGS}" "${SC_DATA}"
[[ -d "${SC_MEDIA}/library" ]] || { echo "up.sh: no media in ${SC_MEDIA}; run scripts/showcase/fetch-media.sh" >&2; exit 1; }
BIN="${PLAYARR_SERVER_BIN:?set PLAYARR_SERVER_BIN to a built playarr-server}"
[[ -f "${SC_PASSWORD_FILE}" ]] || { head -c 18 /dev/urandom | base64 | tr -d '/+=' >"${SC_PASSWORD_FILE}"; chmod 600 "${SC_PASSWORD_FILE}"; }
[[ -f "${SC_ARR_KEY_FILE}" ]] || { head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n' >"${SC_ARR_KEY_FILE}"; chmod 600 "${SC_ARR_KEY_FILE}"; }
alive() { [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null; }

SHOWCASE_MEDIA="${SC_MEDIA}" SHOWCASE_CATALOG="${SC_RUN}/catalog.json" SHOWCASE_RADARR_PORT="${SC_RADARR_PORT}" \
  python3 "${SC_SCRIPT_DIR}/catalog.py"

for k in "radarr:${SC_RADARR_PORT}" "sonarr:${SC_SONARR_PORT}"; do
  alive "${SC_RUN}/${k%%:*}.pid" && continue
  nohup node "${SC_SCRIPT_DIR}/mock-arr.mjs" "${k%%:*}" "${k##*:}" "${SC_RUN}/catalog.json" "${SC_MEDIA}/art" "$(cat "${SC_ARR_KEY_FILE}")" \
    >"${SC_LOGS}/${k%%:*}.log" 2>&1 &
  echo $! >"${SC_RUN}/${k%%:*}.pid"
done

if ! alive "${SC_RUN}/server.pid"; then
  export DATABASE_URL="sqlite://${SC_DATA}/playarr.db?mode=rwc"
  export PLAYARR_ROLE=all
  export PLAYARR_HTTP_BIND_ADDR="127.0.0.1:${SC_BASE_PORT}"
  export PLAYARR_METRICS_BIND_ADDR="127.0.0.1:${SC_METRICS_PORT}"
  export PLAYARR_BOOTSTRAP_ADMIN_USERNAME="${SC_USER}"
  export PLAYARR_BOOTSTRAP_ADMIN_PASSWORD="$(cat "${SC_PASSWORD_FILE}")"
  export PLAYARR_ARTWORK_CACHE_DIR="${SC_DATA}/artwork"
  export PLAYARR_TRANSCODE_SESSION_IDLE_TTL_SECS=60
  [[ -n "${PLAYARR_WEB_ASSETS_DIR:-}" ]] && export PLAYARR_WEB_ASSETS_DIR
  nohup "${BIN}" >"${SC_LOGS}/server.log" 2>&1 &
  echo $! >"${SC_RUN}/server.pid"
fi
for _ in $(seq 1 90); do curl -fsS "${SC_URL}/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "${SC_URL}/healthz" >/dev/null || { echo "server did not start; see ${SC_LOGS}/server.log" >&2; exit 1; }

node "${SC_SCRIPT_DIR}/seed.mjs" "${SC_URL}" "${SC_USER}" "$(cat "${SC_PASSWORD_FILE}")" \
  "${SC_RADARR_PORT}" "${SC_SONARR_PORT}" "$(cat "${SC_ARR_KEY_FILE}")"

# Library dates: "added" follows each release date, so Home reads like a real library, not a fresh import.
sqlite3 "${SC_DATA}/playarr.db" "update works set added_at=release_date where release_date is not null;
update works set availability='available' where availability='unknown';
update seasons set availability='available' where availability='unknown';"
echo "Showcase server: ${SC_URL}  user: ${SC_USER}  password file: ${SC_PASSWORD_FILE}"
