#!/usr/bin/env bash
set -euo pipefail

chart_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rendered="$(mktemp)"
trap 'rm -f "$rendered"' EXIT

helm lint --strict "$chart_dir"
helm template playarr-dev "$chart_dir" --namespace playarr >"$rendered"

test "$(grep -c '^kind: Deployment$' "$rendered")" -eq 8
test "$(grep -c '^          startupProbe:$' "$rendered")" -eq 6
test "$(grep -c '^          readinessProbe:$' "$rendered")" -eq 8
test "$(grep -c '^          livenessProbe:$' "$rendered")" -eq 8
test "$(grep -c '^              path: /$' "$rendered")" -eq 18
grep -q 'value: "playarr-marketing.example.com"' "$rendered"
test "$(grep -c '^kind: Service$' "$rendered")" -eq 8
test "$(grep -c '^kind: Mapping$' "$rendered")" -eq 7
test "$(grep -c '^kind: PersistentVolumeClaim$' "$rendered")" -eq 2
test "$(grep -c '^kind: ServiceAccount$' "$rendered")" -eq 2
test "$(grep -c '^kind: Secret$' "$rendered")" -eq 0
test "$(grep -c '^        kubernetes.io/hostname: dev-node$' "$rendered")" -eq 6
grep -q 'service: "playarr-admin.playarr:80"' "$rendered"
grep -q 'service: "playarr-marketing.playarr:80"' "$rendered"
grep -q 'service: "playarr-nav-perf.playarr:80"' "$rendered"
grep -q 'service: "tv-web.playarr:80"' "$rendered"
grep -q 'service: "tv-web-webos.playarr:80"' "$rendered"
grep -q 'service: "playarr-region-a.playarr:80"' "$rendered"
grep -q 'service: "playarr-region-b.playarr:80"' "$rendered"
if grep -Eq 'service: ".*\.dev:80"' "$rendered"; then
  echo "found a hard-coded dev namespace service reference" >&2
  exit 1
fi
