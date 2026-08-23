#!/usr/bin/env bash
set -euo pipefail

chart_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
rendered=$(mktemp)
trap 'rm -f "$rendered"' EXIT

helm template vidaa-verify "$chart_dir" \
  --namespace vidaa \
  --set backend.image.repository=localhost:5000/streamarr-backend \
  --set backend.image.tag=d22ef94 \
  --set backend.image.pullPolicy=Always \
  --set-string 'nodeSelector.kubernetes\.io/hostname=dev-node' >"$rendered"

test "$(grep -c '^kind: Deployment$' "$rendered")" -eq 2
test "$(grep -c '^kind: Service$' "$rendered")" -eq 2
grep -q '^  name: vidaa-verify-backend$' "$rendered"
grep -q '^  name: vidaa-verify-postgres$' "$rendered"
grep -q 'image: "localhost:5000/streamarr-backend:d22ef94"' "$rendered"
grep -q 'name: vidaa-verify-runtime' "$rendered"
grep -q 'kubernetes.io/hostname: dev-node' "$rendered"
grep -q 'type: ClusterIP' "$rendered"

if grep -Eqi 'headscale|tailscale' "$rendered"; then
  echo 'render unexpectedly contains a Headscale or Tailscale dependency' >&2
  exit 1
fi

if grep -q '^kind: Secret$' "$rendered"; then
  echo 'runtime credentials must remain outside the chart' >&2
  exit 1
fi

printf 'VIDAA verification chart render checks passed\n'
