#!/usr/bin/env bash
set -euo pipefail

src_chart="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The chart ships neutral (empty) defaults; test against the placeholder
# example values as if they were the defaults, so --set key=null still removes keys.
chart_dir="$(mktemp -d)"
cp -r "$src_chart/." "$chart_dir/"
cp "$src_chart/tests/example-values.yaml" "$chart_dir/values.yaml"
trap 'rm -rf "$chart_dir"' EXIT
rendered="$(mktemp)"
trap 'rm -rf "$chart_dir"; rm -f "$rendered"' EXIT

# As shipped, the chart's neutral defaults render nothing and lint cleanly.
helm lint --strict "$src_chart" >/dev/null
test -z "$(helm template playarr-dev "$src_chart" | grep -v '^---$' | tr -d '[:space:]')"
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
a_deployment="$(awk '/^kind: Deployment$/{show=1; block=""} show{block=block $0 ORS} /^---$/{if(show && block ~ /name: playarr-a/) printf "%s", block; show=0}' "$rendered")"
b_deployment="$(awk '/^kind: Deployment$/{show=1; block=""} show{block=block $0 ORS} /^---$/{if(show && block ~ /name: playarr-b/) printf "%s", block; show=0}' "$rendered")"
grep -q 'image: "registry.example.com/playarr-regional:0123abcd"' <<<"$a_deployment"
grep -q 'image: "registry.example.com/playarr-regional:0123abcd"' <<<"$b_deployment"
for deployment in "$a_deployment" "$b_deployment"; do
  grep -A1 -q 'name: PLAYARR_TRANSCODE_MAX_CONCURRENT_JOBS' <<<"$deployment"
  grep -A1 'name: PLAYARR_TRANSCODE_MAX_CONCURRENT_JOBS' <<<"$deployment" | grep -q 'value: "1"'
  grep -A1 -q 'name: PLAYARR_FFMPEG_THREADS' <<<"$deployment"
  grep -A1 'name: PLAYARR_FFMPEG_THREADS' <<<"$deployment" | grep -q 'value: "2"'
done
grep -q '^        supplementalGroups:$' <<<"$a_deployment"
grep -q '^        - 2000$' <<<"$a_deployment"
grep -q '^        supplementalGroups:$' <<<"$b_deployment"
grep -q '^        - 2000$' <<<"$b_deployment"
grep -q 'service: "playarr-admin.playarr:80"' "$rendered"
grep -q 'service: "playarr-marketing.playarr:80"' "$rendered"
grep -q 'service: "playarr-nav-perf.playarr:80"' "$rendered"
grep -q 'service: "tv-web.playarr:80"' "$rendered"
grep -q 'service: "tv-web-webos.playarr:80"' "$rendered"
grep -q 'host: "tv-web-webos.example.com"' "$rendered"
# Regional servers pull a self-contained image from the registry: no hostPath runtime.
test "$(grep -c 'image: "registry.example.com/playarr-regional:' "$rendered")" -eq 2
# Both instances take the one shared regionalImage; no per-instance image is set in the example.
test "$(grep -c '^    image: registry.example.com/playarr-regional' "$chart_dir/values.yaml")" -eq 0
test "$(helm template playarr-dev "$chart_dir" --namespace playarr --set regionalImage=registry.example.com/playarr-regional:feedbeef | grep -c 'image: "registry.example.com/playarr-regional:feedbeef"')" -eq 2
# A per-instance image remains an optional override.
override="$(helm template playarr-dev "$chart_dir" --namespace playarr --set regionalInstances.playarr-b.image=registry.example.com/playarr-regional:cafe0001)"
test "$(grep -c 'image: "registry.example.com/playarr-regional:cafe0001"' <<<"$override")" -eq 1
test "$(grep -c 'image: "registry.example.com/playarr-regional:0123abcd"' <<<"$override")" -eq 1
# No shared image and no override: the render fails instead of emitting an empty image.
if helm template playarr-dev "$chart_dir" --namespace playarr --set regionalImage= >/dev/null 2>&1; then echo "render succeeded without any regional image" >&2; exit 1; fi
if grep -v '^ *#' "$rendered" | grep -q 'streamarr-runtime\|/opt/streamarr\|imagePullPolicy: Never'; then echo "forbidden hostPath runtime reference rendered" >&2; exit 1; fi
# Declarative source-instance URLs reach both regional servers as one env var.
test "$(grep -c '^            - name: PLAYARR_SOURCE_INSTANCE_URLS$' "$rendered")" -eq 2
grep -q 'radarr=http://radarr.media.svc.cluster.local:7878,' "$rendered"
grep -q 'dubarr=http://dubarr.dubarr.svc.cluster.local:8686' "$rendered"
test "$(grep -c '^            - name: PLAYARR_DUBARR_API_KEY$' "$rendered")" -eq 2
# Dubarr and Ombi API key references are optional on both instances.
test "$(grep -c '^                  optional: true$' "$rendered")" -eq 4
test "$(grep -c '^            - name: PLAYARR_WEB_ASSETS_DIR$' "$rendered")" -eq 2
# TLS instances: Emissary originates TLS to the pod on the https Service port.
grep -q 'service: "https://playarr-a.playarr:443"' "$rendered"
grep -q 'service: "https://playarr-b.playarr:443"' "$rendered"
if grep -q 'service: "playarr-[ab].playarr:80"' "$rendered"; then echo "forbidden pattern rendered: line '$LINENO'" >&2; exit 1; fi
test "$(grep -c '^kind: Certificate$' "$rendered")" -eq 2
grep -q '^    - "playarr-a.example.com"$' "$rendered"
grep -q '^    - "playarr-b.example.com"$' "$rendered"
test "$(grep -c '^    name: letsencrypt-prod$' "$rendered")" -eq 2
test "$(grep -c 'argocd.argoproj.io/sync-wave: "-1"' "$rendered")" -eq 2
test "$(grep -c 'value: /tls/tls.crt$' "$rendered")" -eq 2
test "$(grep -c 'value: /tls/tls.key$' "$rendered")" -eq 2
test "$(grep -c '^              scheme: HTTPS$' "$rendered")" -eq 4
test "$(grep -c '^            secretName: playarr-[ab]-tls$' "$rendered")" -eq 2
test "$(grep -c '^              mountPath: /tls$' "$rendered")" -eq 2
# The relay (acme) is enabled by default and serves HTTPS on its own, so the
# plain-HTTP opt-out needs both static tls and the relay turned off.
no_tls="$(mktemp)"
trap 'rm -rf "$chart_dir"; rm -f "$rendered" "$no_tls"' EXIT
helm template playarr-dev "$chart_dir" --namespace playarr \
  --set regionalInstances.playarr-a.tls=null \
  --set regionalInstances.playarr-b.tls=null \
  --set regionalInstances.playarr-a.acme.enabled=false \
  --set regionalInstances.playarr-b.acme.enabled=false >"$no_tls"
test "$(grep -c '^kind: Certificate$' "$no_tls")" -eq 0
test "$(grep -c 'PLAYARR_TLS_' "$no_tls")" -eq 0
grep -q 'service: "playarr-a.playarr:80"' "$no_tls"
grep -q 'service: "playarr-b.playarr:80"' "$no_tls"
test "$(grep -c 'PLAYARR_ACME\|PLAYARR_RELAY_REGISTER' "$no_tls")" -eq 0
test "$(grep -c '^              hostPort: ' "$rendered")" -eq 2
test "$(grep -c '^              hostIP: ' "$rendered")" -eq 2
grep -q '^              hostIP: "203.0.113.10"$' "$rendered"
grep -q '^              hostIP: "203.0.113.20"$' "$rendered"
test "$(grep -c '^              hostPort: 8484$' "$rendered")" -eq 2
# hostExposure is optional: omitting it must remove hostIP/hostPort (the relay
# registers hostExposure.hostIP, so it is turned off for this opt-out too).
no_host="$(mktemp)"
trap 'rm -rf "$chart_dir"; rm -f "$rendered" "$no_tls" "$no_host"' EXIT
helm template playarr-dev "$chart_dir" --namespace playarr \
  --set regionalInstances.playarr-a.hostExposure=null \
  --set regionalInstances.playarr-b.hostExposure=null \
  --set regionalInstances.playarr-a.acme.enabled=false \
  --set regionalInstances.playarr-b.acme.enabled=false >"$no_host"
test "$(grep -c 'hostPort:' "$no_host")" -eq 0
# Invalid values must be rejected by the schema.
if helm template playarr-dev "$chart_dir" --set regionalInstances.playarr-a.hostExposure.hostPort=70000 >/dev/null 2>&1; then
  echo "schema accepted an out-of-range hostPort" >&2
  exit 1
fi
# The relay is enabled by default on both regional servers.
test "$(grep -c 'PLAYARR_RELAY_REGISTER' "$rendered")" -eq 2
# Enabling the relay on top of static TLS: both certificates are configured, the
# transport stays HTTPS, and only 8484 is published (no port 80, no DNS port).
relay="$(mktemp)"
trap 'rm -rf "$chart_dir"; rm -f "$rendered" "$no_tls" "$no_host" "$relay"' EXIT
helm template playarr-dev "$chart_dir" --namespace playarr \
  --set regionalInstances.playarr-a.acme.enabled=true \
  --set regionalInstances.playarr-b.acme.enabled=true >"$relay"
test "$(grep -c 'value: relay-dns-01$' "$relay")" -eq 2
test "$(grep -c 'PLAYARR_RELAY_REGISTER' "$relay")" -eq 2
test "$(grep -c 'value: /tls/tls.crt$' "$relay")" -eq 2
grep -q 'value: "v4-203-0-113-10.relay.playarr.app"' "$relay"
grep -q 'value: "v4-203-0-113-20.relay.playarr.app"' "$relay"
grep -A1 'name: PLAYARR_PUBLIC_IPV4' "$relay" | grep -q 'value: "203.0.113.10"'
grep -A1 'name: PLAYARR_PUBLIC_IPV4' "$relay" | grep -q 'value: "203.0.113.20"'
grep -q 'service: "https://playarr-a.playarr:443"' "$relay"
test "$(grep -c '^              scheme: HTTPS$' "$relay")" -eq 4
test "$(grep -c '^          startupProbe:$' "$relay")" -eq 6
if grep -Eq 'hostPort: (53|80)$|containerPort: (53|80|443)$|hostNetwork|PLAYARR_RELAY_DNS|PLAYARR_ACME_HTTP01' "$relay"; then echo "forbidden pattern rendered: line '$LINENO'" >&2; exit 1; fi
# Relay without static TLS: HTTPS wiring plus a startup probe for the first issuance.
relay_only="$(mktemp)"
trap 'rm -rf "$chart_dir"; rm -f "$rendered" "$no_tls" "$no_host" "$relay" "$relay_only"' EXIT
helm template playarr-dev "$chart_dir" --namespace playarr \
  --set regionalInstances.playarr-a.tls=null \
  --set regionalInstances.playarr-a.acme.enabled=true >"$relay_only"
grep -q 'service: "https://playarr-a.playarr:443"' "$relay_only"
test "$(grep -c '^          startupProbe:$' "$relay_only")" -eq 7
# The relay registers hostExposure.hostIP, so acme without hostExposure is rejected.
if helm template playarr-dev "$chart_dir" --namespace playarr \
  --set regionalInstances.playarr-a.hostExposure=null \
  --set regionalInstances.playarr-a.acme.enabled=true >/dev/null 2>&1; then
  echo "chart accepted acme without hostExposure" >&2
  exit 1
fi
if grep -Eq 'service: ".*\.dev:80"' "$rendered"; then
  echo "found a hard-coded dev namespace service reference" >&2
  exit 1
fi
