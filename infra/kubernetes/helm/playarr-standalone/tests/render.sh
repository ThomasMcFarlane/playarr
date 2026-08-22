#!/usr/bin/env bash
set -euo pipefail

chart_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
rendered=$(mktemp)
trap 'rm -f "$rendered"' EXIT

helm template playarr "$chart_dir" \
  --namespace playarr \
  --set image.repository=streamarr-runtime \
  --set image.tag=26853ca \
  --set image.pullPolicy=Never \
  --set route.enabled=true \
  --set route.hostname=playarr.example.com \
  --set persistence.enabled=true \
  --set persistence.local.create=true \
  --set persistence.local.path=/var/lib/streamarr \
  --set persistence.local.nodeHostname=region-b \
  --set nodeSelector.kubernetes\.io/hostname=region-b >"$rendered"

grep -q 'persistentVolumeReclaimPolicy: Retain' "$rendered"
grep -q 'type: Recreate' "$rendered"
grep -q 'hostname: playarr.example.com' "$rendered"
grep -q 'path: /var/lib/streamarr' "$rendered"
grep -q 'name: playarr-runtime' "$rendered"
if grep -Eq 'helm\.sh/hook:.*(delete|cleanup)|kind: Job' "$rendered"; then
  echo 'render unexpectedly contains a destructive hook or Job' >&2
  exit 1
fi
