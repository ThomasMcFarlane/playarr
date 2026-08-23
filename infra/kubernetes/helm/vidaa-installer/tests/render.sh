#!/usr/bin/env bash
set -euo pipefail

chart_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_contains() {
  local rendered="$1"
  local expected="$2"
  grep -Fq -- "$expected" <<<"$rendered" || fail "render did not contain: $expected"
}

assert_not_contains() {
  local rendered="$1"
  local unexpected="$2"
  if grep -Fq -- "$unexpected" <<<"$rendered"; then
    fail "render unexpectedly contained: $unexpected"
  fi
}

disabled="$(helm template vidaa-installer "$chart_dir")"
assert_not_contains "$disabled" 'lan-dns.example.com/enabled'
assert_not_contains "$disabled" 'kind: Host'
assert_not_contains "$disabled" 'kind: Mapping'
assert_not_contains "$disabled" 'kind: TLSContext'

empty_allowlist="$(helm template vidaa-installer "$chart_dir" \
  --set dns.mode=allowlist \
  --set-string 'dns.clients[0].cidr=192.0.2.10/32' \
  --set 'dns.clients[0].enabled=false')"
assert_not_contains "$empty_allowlist" 'lan-dns.example.com/enabled'

allowlist="$(helm template vidaa-installer "$chart_dir" \
  --set dns.mode=allowlist \
  --set-string 'dns.clients[0].cidr=192.0.2.10/32' \
  --set 'dns.clients[0].enabled=true' \
  --set-string 'dns.clients[1].cidr=192.0.2.11/32' \
  --set 'dns.clients[1].enabled=false')"
assert_contains "$allowlist" 'lan-dns.example.com/enabled: "true"'
assert_contains "$allowlist" "incidr(client_ip(), '192.0.2.10/32')"
assert_not_contains "$allowlist" "incidr(client_ip(), '192.0.2.11/32')"
assert_contains "$allowlist" "type() == 'A'"
assert_contains "$allowlist" "type() != 'A'"
assert_contains "$allowlist" 'answer "vidaahub.com. 30 IN A {$LAN_DNS_TARGET_IPV4}"'
assert_contains "$allowlist" 'rcode NOERROR'

all_clients="$(helm template vidaa-installer "$chart_dir" --set dns.mode=all)"
assert_contains "$all_clients" 'lan-dns.example.com/enabled: "true"'
assert_not_contains "$all_clients" 'incidr(client_ip()'

ingress="$(helm template vidaa-installer "$chart_dir" \
  --set ingress.enabled=true \
  --set ingress.tlsSecretName=vidaa-portal-tls)"
assert_contains "$ingress" 'hostname: "*"'
assert_contains "$ingress" 'name: "vidaa-portal-tls"'
assert_contains "$ingress" 'hostname: vidaahub.com'
assert_contains "$ingress" 'rewrite: /vidaa-store/'
assert_contains "$ingress" 'service: https://playarr.app:443'
assert_contains "$ingress" 'host_rewrite: playarr.app'

upstream="$(helm template vidaa-installer "$chart_dir" \
  --set ingress.enabled=true \
  --set ingress.tlsSecretName=vidaa-portal-tls \
  --set upstream.enabled=true \
  --set upstream.tlsSecretName=vidaa-portal-tls \
  --set upstream.publicRoute.enabled=true \
  --set upstream.publicRoute.hostname=playarr.example.com)"
assert_contains "$upstream" 'kind: TLSContext'
assert_contains "$upstream" 'name: vidaa-upstream'
assert_contains "$upstream" 'secret: vidaa-portal-tls'
assert_contains "$upstream" 'sni: "playarr.app"'
assert_contains "$upstream" 'name: playarr-public'
assert_contains "$upstream" 'hostname: "playarr.example.com"'
assert_contains "$upstream" 'tls: vidaa-upstream'
assert_contains "$upstream" 'allow_upgrade:'

if grep -Eqi 'headscale|tailscale' <<<"$upstream"; then
  fail 'render unexpectedly contains a Headscale or Tailscale dependency'
fi

if helm template vidaa-installer "$chart_dir" --set dns.mode=invalid >/dev/null 2>&1; then
  fail 'invalid DNS mode passed schema validation'
fi

if helm template vidaa-installer "$chart_dir" \
  --set dns.mode=allowlist \
  --set-string 'dns.clients[0].cidr=999.0.2.10/32' \
  --set 'dns.clients[0].enabled=true' >/dev/null 2>&1; then
  fail 'invalid client CIDR passed schema validation'
fi

if helm template vidaa-installer "$chart_dir" --set ingress.enabled=true >/dev/null 2>&1; then
  fail 'enabled ingress without a TLS Secret name passed schema validation'
fi

if helm template vidaa-installer "$chart_dir" --set upstream.enabled=true >/dev/null 2>&1; then
  fail 'enabled upstream TLS without a Secret name passed schema validation'
fi

printf 'VIDAA installer chart render checks passed\n'
