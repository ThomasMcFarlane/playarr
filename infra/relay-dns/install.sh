#!/usr/bin/env bash
# Install, but do not enable or start, the authoritative relay.playarr.app DNS service.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
COREDNS_SRC="${1:-${SCRIPT_DIR}/coredns}"
CONFIG_DIR="/etc/streamarr-relay-dns"
UNIT_DIR="/etc/systemd/system"
SERVICE_USER="streamarr-relay-dns"

if [[ "${EUID}" -ne 0 ]]; then
  printf 'error: must be run as root\n' >&2
  exit 1
fi
if [[ "$(uname -s)" != "Linux" ]] || ! command -v systemctl >/dev/null 2>&1; then
  printf 'error: this installer requires Linux with systemd\n' >&2
  exit 1
fi
if [[ ! -x "${COREDNS_SRC}" ]]; then
  printf 'error: CoreDNS binary not found or not executable: %s\n' "${COREDNS_SRC}" >&2
  exit 1
fi

if ! id "${SERVICE_USER}" &>/dev/null; then
  useradd --system --user-group --no-create-home --home-dir /nonexistent \
    --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

install -o root -g root -m 0755 "${COREDNS_SRC}" /usr/local/bin/coredns
install -d -o root -g "${SERVICE_USER}" -m 0750 "${CONFIG_DIR}"
install -o root -g "${SERVICE_USER}" -m 0640 \
  "${SCRIPT_DIR}/Corefile" "${CONFIG_DIR}/Corefile"
install -o root -g "${SERVICE_USER}" -m 0640 \
  "${SCRIPT_DIR}/db.relay.playarr.app" "${CONFIG_DIR}/db.relay.playarr.app"
install -o root -g root -m 0644 \
  "${SCRIPT_DIR}/streamarr-relay-dns.service" \
  "${UNIT_DIR}/streamarr-relay-dns.service"
systemctl daemon-reload

printf '%s\n' \
  'Install complete. Review the configuration, then run:' \
  '  systemctl enable --now streamarr-relay-dns.service'
