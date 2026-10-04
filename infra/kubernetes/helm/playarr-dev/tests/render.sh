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
# Regional media access uses the host ACL group on both nodes.
node_a_deployment="$(awk '/^kind: Deployment$/{show=1; block=""} show{block=block $0 ORS} /^---$/{if(show && block ~ /name: playarr-region-a/) printf "%s", block; show=0}' "$rendered")"
node_b_deployment="$(awk '/^kind: Deployment$/{show=1; block=""} show{block=block $0 ORS} /^---$/{if(show && block ~ /name: playarr-region-b/) printf "%s", block; show=0}' "$rendered")"
grep -q 'image: "registry.example.com/playarr-regional:80c3cb62"' <<<"$node_a_deployment"
grep -q 'image: "registry.example.com/playarr-regional:80c3cb62"' <<<"$node_b_deployment"
grep -q '^        supplementalGroups:$' <<<"$node_a_deployment"
grep -q '^        - 2000$' <<<"$node_a_deployment"
grep -q '^        supplementalGroups:$' <<<"$node_b_deployment"
grep -q '^        - 2000$' <<<"$node_b_deployment"
grep -q 'service: "playarr-admin.playarr:80"' "$rendered"
grep -q 'service: "playarr-marketing.playarr:80"' "$rendered"
grep -q 'service: "playarr-nav-perf.playarr:80"' "$rendered"
grep -q 'service: "tv-web.playarr:80"' "$rendered"
grep -q 'service: "tv-web-webos.playarr:80"' "$rendered"
grep -q 'host: "tv-web-webos.example.com"' "$rendered"
# Regional servers pull a self-contained image from the registry: no hostPath runtime.
test "$(grep -c 'image: "registry.example.com/playarr-regional:' "$rendered")" -eq 2
if grep -v '^ *#' "$rendered" | grep -q 'streamarr-runtime\|/opt/streamarr\|imagePullPolicy: Never'; then echo "forbidden hostPath runtime reference rendered" >&2; exit 1; fi
# Declarative source-instance URLs reach both regional servers as one env var.
test "$(grep -c '^            - name: PLAYARR_SOURCE_INSTANCE_URLS$' "$rendered")" -eq 2
grep -q 'radarr=http://radarr.media.svc.cluster.local:7878,' "$rendered"
grep -q 'dubarr=http://dubarr.dubarr.svc.cluster.local:8686' "$rendered"
test "$(grep -c '^            - name: PLAYARR_DUBARR_API_KEY$' "$rendered")" -eq 2
test "$(grep -c '^                  optional: true$' "$rendered")" -eq 2
test "$(grep -c '^            - name: PLAYARR_WEB_ASSETS_DIR$' "$rendered")" -eq 2
# TLS instances: Emissary originates TLS to the pod on the https Service port.
grep -q 'service: "https://playarr-region-a.playarr:443"' "$rendered"
grep -q 'service: "https://playarr-region-b.playarr:443"' "$rendered"
if grep -q 'service: "playarr-eu[34].playarr:80"' "$rendered"; then echo "forbidden pattern rendered: line '$LINENO'" >&2; exit 1; fi
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
# The relay (acme) is enabled by default and serves HTTPS on its own, so the
# plain-HTTP opt-out needs both static tls and the relay turned off.
no_tls="$(mktemp)"
trap 'rm -f "$rendered" "$no_tls"' EXIT
helm template playarr-dev "$chart_dir" --namespace playarr \
  --set regionalInstances.playarr-region-a.tls=null \
  --set regionalInstances.playarr-region-b.tls=null \
  --set regionalInstances.playarr-region-a.acme.enabled=false \
  --set regionalInstances.playarr-region-b.acme.enabled=false >"$no_tls"
test "$(grep -c '^kind: Certificate$' "$no_tls")" -eq 0
test "$(grep -c 'PLAYARR_TLS_' "$no_tls")" -eq 0
grep -q 'service: "playarr-region-a.playarr:80"' "$no_tls"
grep -q 'service: "playarr-region-b.playarr:80"' "$no_tls"
test "$(grep -c 'PLAYARR_ACME\|PLAYARR_RELAY_REGISTER' "$no_tls")" -eq 0
test "$(grep -c '^              hostPort: ' "$rendered")" -eq 2
test "$(grep -c '^              hostIP: ' "$rendered")" -eq 2
grep -q '^              hostIP: "203.0.113.10"$' "$rendered"
grep -q '^              hostIP: "203.0.113.20"$' "$rendered"
test "$(grep -c '^              hostPort: 8484$' "$rendered")" -eq 2
# hostExposure is optional: omitting it must remove hostIP/hostPort (the relay
# registers hostExposure.hostIP, so it is turned off for this opt-out too).
no_host="$(mktemp)"
trap 'rm -f "$rendered" "$no_tls" "$no_host"' EXIT
helm template playarr-dev "$chart_dir" --namespace playarr \
  --set regionalInstances.playarr-region-a.hostExposure=null \
  --set regionalInstances.playarr-region-b.hostExposure=null \
  --set regionalInstances.playarr-region-a.acme.enabled=false \
  --set regionalInstances.playarr-region-b.acme.enabled=false >"$no_host"
test "$(grep -c 'hostPort:' "$no_host")" -eq 0
# Invalid values must be rejected by the schema.
if helm template playarr-dev "$chart_dir" --set regionalInstances.playarr-region-a.hostExposure.hostPort=70000 >/dev/null 2>&1; then
  echo "schema accepted an out-of-range hostPort" >&2
  exit 1
fi
# The relay is enabled by default on both regional servers.
test "$(grep -c 'PLAYARR_RELAY_REGISTER' "$rendered")" -eq 2
# Enabling the relay on top of static TLS: both certificates are configured, the
# transport stays HTTPS, and only 8484 is published (no port 80, no DNS port).
relay="$(mktemp)"
trap 'rm -f "$rendered" "$no_tls" "$no_host" "$relay"' EXIT
helm template playarr-dev "$chart_dir" --namespace playarr \
  --set regionalInstances.playarr-region-a.acme.enabled=true \
  --set regionalInstances.playarr-region-b.acme.enabled=true >"$relay"
test "$(grep -c 'value: relay-dns-01$' "$relay")" -eq 2
test "$(grep -c 'PLAYARR_RELAY_REGISTER' "$relay")" -eq 2
test "$(grep -c 'value: /tls/tls.crt$' "$relay")" -eq 2
grep -q 'value: "v4-203-0-113-10.relay.playarr.app"' "$relay"
grep -q 'value: "v4-203-0-113-20.relay.playarr.app"' "$relay"
grep -A1 'name: PLAYARR_PUBLIC_IPV4' "$relay" | grep -q 'value: "203.0.113.10"'
grep -A1 'name: PLAYARR_PUBLIC_IPV4' "$relay" | grep -q 'value: "203.0.113.20"'
grep -q 'service: "https://playarr-region-a.playarr:443"' "$relay"
test "$(grep -c '^              scheme: HTTPS$' "$relay")" -eq 4
test "$(grep -c '^          startupProbe:$' "$relay")" -eq 6
if grep -Eq 'hostPort: (53|80)$|containerPort: (53|80|443)$|hostNetwork|PLAYARR_RELAY_DNS|PLAYARR_ACME_HTTP01' "$relay"; then echo "forbidden pattern rendered: line '$LINENO'" >&2; exit 1; fi
# Relay without static TLS: HTTPS wiring plus a startup probe for the first issuance.
relay_only="$(mktemp)"
trap 'rm -f "$rendered" "$no_tls" "$no_host" "$relay" "$relay_only"' EXIT
helm template playarr-dev "$chart_dir" --namespace playarr \
  --set regionalInstances.playarr-region-a.tls=null \
  --set regionalInstances.playarr-region-a.acme.enabled=true >"$relay_only"
grep -q 'service: "https://playarr-region-a.playarr:443"' "$relay_only"
test "$(grep -c '^          startupProbe:$' "$relay_only")" -eq 7
# The relay registers hostExposure.hostIP, so acme without hostExposure is rejected.
if helm template playarr-dev "$chart_dir" --namespace playarr \
  --set regionalInstances.playarr-region-a.hostExposure=null \
  --set regionalInstances.playarr-region-a.acme.enabled=true >/dev/null 2>&1; then
  echo "chart accepted acme without hostExposure" >&2
  exit 1
fi
if grep -Eq 'service: ".*\.dev:80"' "$rendered"; then
  echo "found a hard-coded dev namespace service reference" >&2
  exit 1
fi
