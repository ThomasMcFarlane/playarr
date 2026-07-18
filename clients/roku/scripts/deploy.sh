#!/usr/bin/env bash
set -euo pipefail

package_path="${1:-build/playarr-roku.zip}"
: "${ROKU_DEV_TARGET:?Set ROKU_DEV_TARGET to the Roku local address}"
: "${ROKU_DEV_PASSWORD:?Set ROKU_DEV_PASSWORD to the Roku developer password}"

curl --fail --show-error --silent --digest \
  --user "rokudev:${ROKU_DEV_PASSWORD}" \
  --form "mysubmit=Install" \
  --form "archive=@${package_path};type=application/zip" \
  "http://${ROKU_DEV_TARGET}/plugin_install" >/dev/null

printf 'Installed %s on %s\n' "${package_path}" "${ROKU_DEV_TARGET}"
