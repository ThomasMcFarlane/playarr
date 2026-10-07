#!/usr/bin/env bash
# Stops the showcase processes started by up.sh (only those recorded in the run directory).
# --purge also deletes the database.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
for f in "${SC_RUN}"/*.pid; do
  [[ -f "$f" ]] || continue
  kill "$(cat "$f")" 2>/dev/null || true
  rm -f "$f"
done
[[ "${1:-}" == "--purge" ]] && rm -rf "${SC_DATA}"
echo "showcase stopped"
