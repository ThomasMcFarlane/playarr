#!/usr/bin/env bash
# Stops the fixture server and stub. `down.sh --purge` also deletes all fixture state.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
for name in server stub; do
  pidfile="${FIX_RUN_DIR}/${name}.pid"
  if [[ -f "${pidfile}" ]]; then
    pid="$(cat "${pidfile}")"
    if kill -0 "${pid}" 2>/dev/null; then kill "${pid}" && echo "stopped ${name} (${pid})"; fi
    rm -f "${pidfile}"
  fi
done
if [[ "${1:-}" == "--purge" ]]; then rm -rf "${FIX_DIR}" && echo "removed ${FIX_DIR}"; fi
