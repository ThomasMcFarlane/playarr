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
grep -q 'host: "tv-web-webos.example.com"' "$rendered"
# TLS instances: Emissary originates TLS to the pod on the https Service port.
grep -q 'service: "https://playarr-region-a.playarr:443"' "$rendered"
grep -q 'service: "https://playarr-region-b.playarr:443"' "$rendered"
! grep -q 'service: "playarr-eu[34].playarr:80"' "$rendered"
test "$(grep -c '^kind: Certificate$' "$rendered")" -eq 2
grep -q '^    - "playarr-a.example.com"$' "$rendered"
grep -q '^    - "playarr-b.example.com"$' "$rendered"
test "$(grep -c '^    name: letsencrypt-prod$' "$rendered")" -eq 2
test "$(grep -c 'argocd.argoproj.io/sync-wave: "-1"' "$rendered")" -eq 2
test "$(grep -c 'value: /tls/tls.crt$' "$rendered")" -eq 2
test "$(grep -c 'value: /tls/tls.key$' "$rendered")" -eq 2
test "$(grep -c '^              scheme: HTTPS$' "$rendered")" -eq 4
test "$(grep -c '^            secretName: playarr-eu[34]-tls$' "$rendered")" -eq 2
test "$(grep -c '^              mountPath: /tls$' "$rendered")" -eq 2
# tls is optional: omitting it restores plain HTTP wiring and drops the Certificate.
no_tls="$(mktemp)"
trap 'rm -f "$rendered" "$no_tls"' EXIT
helm template playarr-dev "$chart_dir" --namespace playarr \
  --set regionalInstances.playarr-region-a.tls=null \
  --set regionalInstances.playarr-region-b.tls=null >"$no_tls"
test "$(grep -c '^kind: Certificate$' "$no_tls")" -eq 0
test "$(grep -c 'PLAYARR_TLS_' "$no_tls")" -eq 0
grep -q 'service: "playarr-region-a.playarr:80"' "$no_tls"
test "$(grep -c '^              hostPort: ' "$rendered")" -eq 2
test "$(grep -c '^              hostIP: ' "$rendered")" -eq 2
grep -q '^              hostIP: "203.0.113.10"$' "$rendered"
grep -q '^              hostIP: "203.0.113.20"$' "$rendered"
test "$(grep -c '^              hostPort: 8484$' "$rendered")" -eq 2
# hostExposure is optional: omitting it must remove hostIP/hostPort.
no_host="$(mktemp)"
trap 'rm -f "$rendered" "$no_tls" "$no_host"' EXIT
helm template playarr-dev "$chart_dir" --namespace playarr \
  --set regionalInstances.playarr-region-a.hostExposure=null \
  --set regionalInstances.playarr-region-b.hostExposure=null >"$no_host"
test "$(grep -c 'hostPort:' "$no_host")" -eq 0
# Invalid values must be rejected by the schema.
if helm template playarr-dev "$chart_dir" --set regionalInstances.playarr-region-a.hostExposure.hostPort=70000 >/dev/null 2>&1; then
  echo "schema accepted an out-of-range hostPort" >&2
  exit 1
fi
if grep -Eq 'service: ".*\.dev:80"' "$rendered"; then
  echo "found a hard-coded dev namespace service reference" >&2
  exit 1
fi
