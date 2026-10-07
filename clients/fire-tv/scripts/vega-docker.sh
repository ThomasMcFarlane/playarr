#!/usr/bin/env bash
# Runs any Vega SDK / react-native CLI command inside the Ubuntu 22.04
# container Dockerfile.vega-sdk describes, so building/running this app
# never depends on the host's own OS (design doc §8.1 -- Amazon supports
# macOS/Ubuntu only) or Node version (a current host Node is often newer than
# Metro 0.76/RN 0.72 tolerate). Nothing under design doc §8.4's "no SDK
# required" list (typecheck/test/gate) should ever need this script --
# reach for it only for build:*/manifest:validate/vpkg:info/vd:*/device:*.
#
# Usage: ./scripts/vega-docker.sh <command to run inside the container>
#   e.g. ./scripts/vega-docker.sh npm run build:release
#        ./scripts/vega-docker.sh npm run vd:start
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIRE_TV_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# The parent of both clients/fire-tv and clients/tv-web -- mounted whole
# (rather than fire-tv and tv-web/packages as two separate mounts at
# unrelated container paths) so metro.config.js's
# `path.resolve(projectRoot, '../tv-web/packages')` and tsconfig.json's
# `../tv-web/packages/...` paths resolve identically inside the container
# to however they resolve on the host -- the container's directory
# structure has to mirror this same relative layout, not just contain both
# directories somewhere.
CLIENTS_DIR="$(cd "${FIRE_TV_DIR}/.." && pwd)"

IMAGE_TAG="playarr-fire-tv-vega-sdk:local"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <command to run inside the Vega SDK container>" >&2
  echo "  e.g.: $0 npm run build:release" >&2
  exit 1
fi

echo "==> Building ${IMAGE_TAG} (cached/no-op if Dockerfile.vega-sdk hasn't changed)..." >&2
docker build \
  --build-arg "UID=${HOST_UID}" \
  -f "${SCRIPT_DIR}/Dockerfile.vega-sdk" \
  -t "${IMAGE_TAG}" \
  "${SCRIPT_DIR}"

# --device /dev/kvm: needed for `npm run vd:start` (the virtual device);
# harmlessly ignored by every other command. Only passed when the host
# actually has it (a CI runner or a different box might not), so a plain typecheck-only user of
# this script never hits a hard failure over a device this command doesn't
# even need.
DOCKER_DEVICE_ARGS=()
if [ -e /dev/kvm ]; then
  DOCKER_DEVICE_ARGS+=(--device /dev/kvm)
fi

exec docker run \
  --rm \
  --interactive \
  --tty \
  --user "${HOST_UID}:${HOST_GID}" \
  "${DOCKER_DEVICE_ARGS[@]}" \
  --volume "${CLIENTS_DIR}:/clients" \
  --workdir "/clients/$(basename "${FIRE_TV_DIR}")" \
  "${IMAGE_TAG}" \
  "$@"
