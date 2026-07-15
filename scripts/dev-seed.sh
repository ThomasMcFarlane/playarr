#!/usr/bin/env bash
#
# scripts/dev-seed.sh
#
# Scripts past the first-run setup wizard of every *arr application in the
# Streamarr dev stack (started by scripts/dev-up.sh, defined in
# infra/docker/docker-compose.dev.yml), so a fresh stack is immediately
# usable instead of presenting six separate onboarding wizards.
#
# For each app this does, in order:
#   1. Recover its API key. Sonarr/Radarr/Lidarr/Readarr/Prowlarr generate a
#      random API key into config.xml the *first time the process boots*,
#      before any UI setup happens -- so we read it rather than "generate"
#      it. Bazarr is architecturally different (Python/Bottle, not the .NET
#      Servarr codebase) and writes its key into config.yaml instead.
#   2. Disable forms authentication for local dev only (PUT config/host),
#      so subsequent curl calls -- and your browser -- don't need a login.
#      NEVER do this against anything internet-reachable.
#   3. Register one root folder / library path and one stub indexer (or the
#      closest equivalent the app has -- see the Bazarr section), so the app
#      is left in a "configured", not "first run", state.
#
# THIS SCRIPT DOES NOT START THE STACK -- run scripts/dev-up.sh first.
# It is safe to re-run: every step checks for an existing value before
# creating a new one.
#
# Usage:
#   ./scripts/dev-seed.sh                        # seed every app
#   ./scripts/dev-seed.sh sonarr radarr prowlarr  # seed a subset
#
# Requires: docker (compose v2 plugin), curl, jq.
#
# Env overrides:
#   COMPOSE_FILE          default: infra/docker/docker-compose.dev.yml
#   COMPOSE_PROJECT_NAME  default: streamarr-dev
#   <APP>_URL              e.g. SONARR_URL (default: http://localhost:<port>)
#   <APP>_CONTAINER         e.g. SONARR_CONTAINER (default: compose service name)
#   <APP>_CONFIG_DIR        host path to the app's /config volume, if bind-mounted
#                            (default: unset -> read via `docker compose exec` instead)
#   <APP>_ROOT_FOLDER       e.g. SONARR_ROOT_FOLDER (default: /data/tv, /data/movies, ...)
#   BAZARR_CONFIG_PATH     in-container path to Bazarr's config.yaml
#                            (default: /config/config/config.yaml)
#
# Seeding sonarr/radarr also exports SONARR_API_KEY/RADARR_API_KEY for the
# remainder of the process, which seed_bazarr picks up (if run in the same
# invocation) to wire up Bazarr's Sonarr/Radarr connections automatically.
#
# NOTE: this script is authored as scaffolding, written to be correct
# against a running dev stack, but it is NOT executed as part of building
# this repo -- infra/docker/docker-compose.dev.yml does not exist yet.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/infra/docker/docker-compose.dev.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-streamarr-dev}"

for cmd in docker curl jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "dev-seed.sh: required command '$cmd' not found on PATH" >&2
    exit 1
  fi
done

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "dev-seed.sh: compose file not found: ${COMPOSE_FILE}" >&2
  echo "             run scripts/dev-up.sh first (which itself requires infra/docker to exist)" >&2
  exit 1
fi

compose() {
  docker compose -f "${COMPOSE_FILE}" -p "${COMPOSE_PROJECT_NAME}" "$@"
}

# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------

# Poll an app's unauthenticated health endpoint until it responds or we
# time out. Sonarr/Radarr/Lidarr/Readarr/Prowlarr all expose an
# unauthenticated `/ping` route (it's what their own Docker HEALTHCHECK
# uses), so we reuse it here instead of guessing at readiness.
wait_for_http() {
  local name="$1" url="$2" timeout_s="${3:-90}"
  local waited=0
  echo "    waiting for ${name} at ${url} ..."
  until curl -fsS -o /dev/null "${url}" 2>/dev/null; do
    sleep 2
    waited=$((waited + 2))
    if [[ "${waited}" -ge "${timeout_s}" ]]; then
      echo "dev-seed.sh: timed out waiting for ${name} (${url}) after ${timeout_s}s" >&2
      return 1
    fi
  done
}

# Read a file from either a bind-mounted host config dir (fast path, no
# docker exec needed) or by `docker compose exec cat` into the container
# (works for named/anonymous volumes too, which is the more likely default
# for a dev compose file that doesn't care about host-visible config).
#
# `<APP>_CONFIG_DIR` is assumed to be bound at the container's /config (the
# convention every image used here follows), so we strip that leading
# "/config/" prefix and re-join to preserve any nesting below it -- e.g.
# Bazarr's config.yaml lives two levels down at /config/config/config.yaml,
# not directly under /config like the Servarr apps' config.xml.
read_container_file() {
  local service="$1" container_path="$2" host_dir_var="$3"
  local host_dir="${!host_dir_var:-}"
  local relative_path="${container_path#/config/}"
  if [[ -n "${host_dir}" && -f "${host_dir}/${relative_path}" ]]; then
    cat "${host_dir}/${relative_path}"
    return 0
  fi
  compose exec -T "${service}" cat "${container_path}"
}

# Sonarr/Radarr/Lidarr/Readarr/Prowlarr (the .NET "Servarr" family) all
# store their API key the same way: an auto-generated <ApiKey> element in
# config.xml, written on first boot before any auth/setup has happened.
# There is no API endpoint to fetch it (chicken-and-egg: you'd need the key
# to call the API) -- reading the file is the only way in.
read_servarr_api_key() {
  local service="$1" host_dir_var="$2"
  local xml
  local attempt=0
  # config.xml is written a few seconds after the process starts, so retry
  # briefly rather than requiring the caller to have slept beforehand.
  until xml="$(read_container_file "${service}" /config/config.xml "${host_dir_var}" 2>/dev/null)" && [[ -n "${xml}" ]]; do
    attempt=$((attempt + 1))
    if [[ "${attempt}" -ge 15 ]]; then
      echo "dev-seed.sh: could not read config.xml from '${service}' after ${attempt} attempts" >&2
      return 1
    fi
    sleep 2
  done
  echo "${xml}" | grep -oE '<ApiKey>[^<]+</ApiKey>' | sed -E 's#</?ApiKey>##g'
}

# Idempotently disable forms auth for local dev (Servarr family only).
# `authenticationMethod: "None"` plus `authenticationRequired: "DisabledForLocalAddresses"`
# mirrors what the setup wizard's "no login" option produces. This is a dev
# convenience ONLY -- never do this on a stack reachable from anywhere but
# localhost/the dev docker network.
disable_servarr_auth() {
  local name="$1" url="$2" api_key="$3" api_version="$4"
  local host_config current merged
  host_config="$(curl -fsS "${url}/api/${api_version}/config/host" -H "X-Api-Key: ${api_key}")"
  current="$(echo "${host_config}" | jq -r '.authenticationMethod')"
  if [[ "${current}" == "None" ]]; then
    echo "    [${name}] auth already disabled"
    return 0
  fi
  merged="$(echo "${host_config}" | jq '.authenticationMethod = "None" | .authenticationRequired = "DisabledForLocalAddresses"')"
  local id
  id="$(echo "${merged}" | jq -r '.id')"
  curl -fsS -X PUT "${url}/api/${api_version}/config/host/${id}" \
    -H "X-Api-Key: ${api_key}" -H "Content-Type: application/json" \
    -d "${merged}" >/dev/null
  echo "    [${name}] auth disabled for local dev"
}

# Idempotently add a root folder (Sonarr/Radarr/Lidarr/Readarr all share
# this endpoint shape -- POST /api/<version>/rootfolder { "path": ... }).
add_servarr_root_folder() {
  local name="$1" url="$2" api_key="$3" api_version="$4" path="$5"
  local existing
  existing="$(curl -fsS "${url}/api/${api_version}/rootfolder" -H "X-Api-Key: ${api_key}")"
  if echo "${existing}" | jq -e --arg p "${path}" '.[] | select(.path == $p)' >/dev/null; then
    echo "    [${name}] root folder ${path} already present"
    return 0
  fi
  curl -fsS -X POST "${url}/api/${api_version}/rootfolder" \
    -H "X-Api-Key: ${api_key}" -H "Content-Type: application/json" \
    -d "$(jq -n --arg p "${path}" '{path: $p}')" >/dev/null
  echo "    [${name}] root folder ${path} added"
}

# Idempotently add a stub Torznab/Newznab indexer. This deliberately points
# at a placeholder URL -- it exists purely so the app is out of its "no
# indexers configured" empty state; swap it for a real indexer (or a real
# Prowlarr sync, see seed_prowlarr below) once you actually need search to
# work.
add_servarr_stub_indexer() {
  local name="$1" url="$2" api_key="$3" api_version="$4" indexer_name="$5" protocol="$6" categories_json="$7"
  local existing
  existing="$(curl -fsS "${url}/api/${api_version}/indexer" -H "X-Api-Key: ${api_key}")"
  if echo "${existing}" | jq -e --arg n "${indexer_name}" '.[] | select(.name == $n)' >/dev/null; then
    echo "    [${name}] stub indexer already present"
    return 0
  fi
  local implementation config_contract
  if [[ "${protocol}" == "torrent" ]]; then
    implementation="Torznab"
    config_contract="TorznabSettings"
  else
    implementation="Newznab"
    config_contract="NewznabSettings"
  fi
  local payload
  payload="$(jq -n \
    --arg name "${indexer_name}" \
    --arg impl "${implementation}" \
    --arg cc "${config_contract}" \
    --arg protocol "${protocol}" \
    --argjson categories "${categories_json}" \
    '{
      name: $name,
      implementation: $impl,
      configContract: $cc,
      protocol: $protocol,
      enable: true,
      priority: 25,
      fields: [
        {name: "baseUrl", value: "http://prowlarr:9696/1/api"},
        {name: "apiPath", value: "/api"},
        {name: "categories", value: $categories},
        {name: "apiKey", value: "dev-seed-stub-key"}
      ]
    }')"
  curl -fsS -X POST "${url}/api/${api_version}/indexer" \
    -H "X-Api-Key: ${api_key}" -H "Content-Type: application/json" \
    -d "${payload}" >/dev/null
  echo "    [${name}] stub indexer '${indexer_name}' added"
}

# ---------------------------------------------------------------------------
# Per-app seeders
# ---------------------------------------------------------------------------

seed_sonarr() {
  local url="${SONARR_URL:-http://localhost:8989}"
  local service="${SONARR_CONTAINER:-sonarr}"
  echo "==> Sonarr (${url})"
  wait_for_http "sonarr" "${url}/ping"
  local key
  key="$(read_servarr_api_key "${service}" SONARR_CONFIG_DIR)"
  echo "    api key: ${key:0:8}...(redacted)"
  # Sonarr has been on API v3 since the 2020 rewrite.
  disable_servarr_auth "sonarr" "${url}" "${key}" v3
  add_servarr_root_folder "sonarr" "${url}" "${key}" v3 "${SONARR_ROOT_FOLDER:-/data/tv}"
  # Newznab category 5000 = TV, subtree 5030/5040/5045 = SD/HD/UHD.
  add_servarr_stub_indexer "sonarr" "${url}" "${key}" v3 "Dev Stub (Torznab)" torrent '[5000,5030,5040,5045]'
  # Exported (not `local`) so seed_bazarr, if run in the same invocation,
  # can wire up a Sonarr connection without re-deriving the key.
  export SONARR_API_KEY="${key}"
}

seed_radarr() {
  local url="${RADARR_URL:-http://localhost:7878}"
  local service="${RADARR_CONTAINER:-radarr}"
  echo "==> Radarr (${url})"
  wait_for_http "radarr" "${url}/ping"
  local key
  key="$(read_servarr_api_key "${service}" RADARR_CONFIG_DIR)"
  echo "    api key: ${key:0:8}...(redacted)"
  # Radarr is also API v3 (it and Sonarr were rewritten on the same base).
  disable_servarr_auth "radarr" "${url}" "${key}" v3
  add_servarr_root_folder "radarr" "${url}" "${key}" v3 "${RADARR_ROOT_FOLDER:-/data/movies}"
  # Newznab category 2000 = Movies.
  add_servarr_stub_indexer "radarr" "${url}" "${key}" v3 "Dev Stub (Torznab)" torrent '[2000,2010,2020,2030,2040,2045,2050,2060]'
  # Exported for seed_bazarr, same reasoning as SONARR_API_KEY above.
  export RADARR_API_KEY="${key}"
}

seed_lidarr() {
  local url="${LIDARR_URL:-http://localhost:8686}"
  local service="${LIDARR_CONTAINER:-lidarr}"
  echo "==> Lidarr (${url})"
  wait_for_http "lidarr" "${url}/ping"
  local key
  key="$(read_servarr_api_key "${service}" LIDARR_CONFIG_DIR)"
  echo "    api key: ${key:0:8}...(redacted)"
  # QUIRK: Lidarr forked off before the Sonarr/Radarr v3 API rewrite, so it
  # is still on API v1 -- do not assume v3 here like the two above.
  disable_servarr_auth "lidarr" "${url}" "${key}" v1
  add_servarr_root_folder "lidarr" "${url}" "${key}" v1 "${LIDARR_ROOT_FOLDER:-/data/music}"
  # Newznab category 3000 = Audio.
  add_servarr_stub_indexer "lidarr" "${url}" "${key}" v1 "Dev Stub (Torznab)" torrent '[3000,3010,3020,3030,3040]'
}

seed_readarr() {
  local url="${READARR_URL:-http://localhost:8787}"
  local service="${READARR_CONTAINER:-readarr}"
  echo "==> Readarr (${url})"
  wait_for_http "readarr" "${url}/ping"
  local key
  key="$(read_servarr_api_key "${service}" READARR_CONFIG_DIR)"
  echo "    api key: ${key:0:8}...(redacted)"
  # QUIRK: like Lidarr, Readarr is also still on API v1.
  disable_servarr_auth "readarr" "${url}" "${key}" v1
  add_servarr_root_folder "readarr" "${url}" "${key}" v1 "${READARR_ROOT_FOLDER:-/data/books}"
  # Newznab category 7000 = Books.
  add_servarr_stub_indexer "readarr" "${url}" "${key}" v1 "Dev Stub (Torznab)" torrent '[7000,7020,7030]'
}

seed_prowlarr() {
  local url="${PROWLARR_URL:-http://localhost:9696}"
  local service="${PROWLARR_CONTAINER:-prowlarr}"
  echo "==> Prowlarr (${url})"
  wait_for_http "prowlarr" "${url}/ping"
  local key
  key="$(read_servarr_api_key "${service}" PROWLARR_CONFIG_DIR)"
  echo "    api key: ${key:0:8}...(redacted)"
  # Prowlarr is also API v1 (it started life on the newer Servarr base but
  # kept v1 numbering; don't assume v3 by analogy with Sonarr/Radarr).
  disable_servarr_auth "prowlarr" "${url}" "${key}" v1
  # QUIRK: Prowlarr has no concept of a root folder -- it's an indexer
  # aggregator, not a library manager -- so there is no add_servarr_root_folder
  # call here. Its indexer objects also require a valid appProfileId (an
  # "App Profile" controls which apps an indexer is synced to); Prowlarr
  # ships a default profile named "Standard" on first boot, so look that up
  # rather than hardcoding id=1.
  local profile_id
  profile_id="$(curl -fsS "${url}/api/v1/appprofiles" -H "X-Api-Key: ${key}" | jq -r '.[0].id')"
  local existing
  existing="$(curl -fsS "${url}/api/v1/indexer" -H "X-Api-Key: ${key}")"
  if echo "${existing}" | jq -e '.[] | select(.name == "Dev Stub (Torznab)")' >/dev/null; then
    echo "    [prowlarr] stub indexer already present"
  else
    local payload
    payload="$(jq -n --argjson appProfileId "${profile_id}" '{
      name: "Dev Stub (Torznab)",
      implementation: "Torznab",
      configContract: "TorznabSettings",
      protocol: "torrent",
      enable: true,
      priority: 25,
      appProfileId: $appProfileId,
      fields: [
        {name: "baseUrl", value: "http://localhost:9117/"},
        {name: "apiPath", value: "/api"},
        {name: "categories", value: [5000, 2000, 3000, 7000]},
        {name: "apiKey", value: "dev-seed-stub-key"}
      ]
    }')"
    curl -fsS -X POST "${url}/api/v1/indexer" \
      -H "X-Api-Key: ${key}" -H "Content-Type: application/json" \
      -d "${payload}" >/dev/null
    echo "    [prowlarr] stub indexer added (appProfileId=${profile_id})"
  fi
  # NOT implemented here: syncing this indexer out to Sonarr/Radarr/etc via
  # POST /api/v1/applications. That requires each app's API key (already
  # captured above if you run this script for all apps in one invocation)
  # and is a reasonable follow-up once real indexers replace the stub.
}

seed_bazarr() {
  local url="${BAZARR_URL:-http://localhost:6767}"
  local service="${BAZARR_CONTAINER:-bazarr}"
  # QUIRK: Bazarr is a Python/Bottle app, not part of the .NET Servarr
  # family, so none of the config.xml / /ping / X-Api-Key helpers above
  # apply to it:
  #   - its API key lives in config.yaml under `auth: apikey: ...`
  #     (default path inside the container: /config/config/config.yaml --
  #     linuxserver's bazarr image uses /config as the data dir, and Bazarr
  #     itself nests its own config under <data_dir>/config/config.yaml;
  #     override BAZARR_CONFIG_PATH if a different image layout is used).
  #   - the auth header is `X-API-KEY` (all caps, unlike Sonarr/Radarr's
  #     `X-Api-Key`), and the API is unversioned (`/api/...`, no v1/v3).
  #   - Bazarr has no root-folder or indexer concept at all: it doesn't
  #     manage a library, it subtitles one that Sonarr/Radarr already
  #     manage. Its closest equivalents are (a) wiring up its Sonarr/Radarr
  #     *connections* (the "root folder" analogue -- this is how Bazarr
  #     learns what media exists) and (b) enabling one subtitle *provider*
  #     (the "indexer" analogue). We use podnapisi.net as the stub provider
  #     because it's one of the few that needs no account/API key, matching
  #     the spirit of a zero-config "stub".
  echo "==> Bazarr (${url})"
  wait_for_http "bazarr" "${url}/"
  local config_path="${BAZARR_CONFIG_PATH:-/config/config/config.yaml}"
  local yaml key
  local attempt=0
  until yaml="$(read_container_file "${service}" "${config_path}" BAZARR_CONFIG_DIR 2>/dev/null)" && [[ -n "${yaml}" ]]; do
    attempt=$((attempt + 1))
    if [[ "${attempt}" -ge 15 ]]; then
      echo "dev-seed.sh: could not read ${config_path} from '${service}' after ${attempt} attempts" >&2
      return 1
    fi
    sleep 2
  done
  key="$(echo "${yaml}" | awk '/^auth:/{f=1; next} f && /apikey:/{print $2; exit}' | tr -d "\"'")"
  if [[ -z "${key}" ]]; then
    echo "dev-seed.sh: could not parse apikey out of ${config_path}" >&2
    return 1
  fi
  echo "    api key: ${key:0:8}...(redacted)"

  # Best-effort connection to Sonarr/Radarr, reusing the API keys those
  # seeders captured earlier in the same run (only works if this script was
  # invoked for sonarr/radarr too -- otherwise these env vars are unset and
  # we just skip the wiring, which is still a valid partial-seed outcome).
  #
  # NOTE: unlike the Servarr REST APIs above, Bazarr's settings save
  # endpoint (POST /api/system/settings) is the same multipart form its own
  # Settings UI page submits, not a documented/versioned JSON API -- field
  # names below are accurate as of Bazarr's current settings schema but are
  # more likely to drift across Bazarr releases than anything else in this
  # script. Verify against a running instance if this stops working.
  # Gate on the *captured key*, not just the URL var, since the URL default
  # is always non-empty -- only a real SONARR_API_KEY means seed_sonarr
  # actually ran (and succeeded) earlier in this invocation.
  local form_args=()
  if [[ -n "${SONARR_API_KEY:-}" ]]; then
    local sonarr_url="${SONARR_URL:-http://localhost:8989}"
    form_args+=(-F "settings-general-use_sonarr=True")
    form_args+=(-F "settings-sonarr-ip=$(echo "${sonarr_url}" | sed -E 's#^https?://([^:/]+).*#\1#')")
    form_args+=(-F "settings-sonarr-port=$(echo "${sonarr_url}" | sed -E 's#^https?://[^:/]+:?([0-9]*).*#\1#')")
    form_args+=(-F "settings-sonarr-apikey=${SONARR_API_KEY}")
  else
    form_args+=(-F "settings-general-use_sonarr=False")
    echo "    [bazarr] SONARR_API_KEY not set (run seed_sonarr in the same invocation to wire this up) -- skipping Sonarr connection"
  fi
  if [[ -n "${RADARR_API_KEY:-}" ]]; then
    local radarr_url="${RADARR_URL:-http://localhost:7878}"
    form_args+=(-F "settings-general-use_radarr=True")
    form_args+=(-F "settings-radarr-ip=$(echo "${radarr_url}" | sed -E 's#^https?://([^:/]+).*#\1#')")
    form_args+=(-F "settings-radarr-port=$(echo "${radarr_url}" | sed -E 's#^https?://[^:/]+:?([0-9]*).*#\1#')")
    form_args+=(-F "settings-radarr-apikey=${RADARR_API_KEY}")
  else
    form_args+=(-F "settings-general-use_radarr=False")
    echo "    [bazarr] RADARR_API_KEY not set (run seed_radarr in the same invocation to wire this up) -- skipping Radarr connection"
  fi
  form_args+=(-F "settings-general-enabled_providers=podnapisi")

  curl -fsS -X POST "${url}/api/system/settings" \
    -H "X-API-KEY: ${key}" \
    "${form_args[@]}" >/dev/null || \
    echo "    [bazarr] settings POST failed -- field names may have drifted, see the QUIRK comment above" >&2

  echo "    [bazarr] general settings updated, podnapisi enabled as stub subtitle provider"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

all_apps=(sonarr radarr lidarr readarr prowlarr bazarr)
requested=("${@:-${all_apps[@]}}")

failures=()
for app in "${requested[@]}"; do
  case "${app}" in
    sonarr|radarr|lidarr|readarr|prowlarr|bazarr) ;;
    *)
      echo "dev-seed.sh: unknown app '${app}' (expected one of: ${all_apps[*]})" >&2
      exit 1
      ;;
  esac
done

for app in "${requested[@]}"; do
  if ! "seed_${app}"; then
    echo "!!  ${app} seed failed, continuing with the rest" >&2
    failures+=("${app}")
  fi
done

echo
if [[ "${#failures[@]}" -eq 0 ]]; then
  echo "dev-seed.sh: done, all requested apps seeded."
else
  echo "dev-seed.sh: done with failures: ${failures[*]}" >&2
  exit 1
fi
