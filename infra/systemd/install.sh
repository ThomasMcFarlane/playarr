#!/usr/bin/env bash
#
# install.sh - install (but do NOT enable or start) the Playarr Server systemd
# service on a Linux host.
#
# What this script does:
#   1. Creates the playarr system user/group (if missing).
#   2. Creates /etc/playarr, /var/lib/playarr, /var/log/playarr with
#      correct ownership/permissions.
#   3. Copies the playarr-server binary to /usr/local/bin/playarr-server and,
#      when a web/ directory sits beside the binary (as in the release
#      tarball), the Admin UI to /var/lib/playarr/web.
#   4. Seeds /etc/playarr/playarr.env from playarr.env.example if it
#      doesn't already exist (never overwrites an existing env file).
#   5. Copies the three unit files to /etc/systemd/system/.
#   6. Runs `systemctl daemon-reload`.
#
# What this script deliberately does NOT do:
#   - It does not run `systemctl enable` or `systemctl start` on anything.
#   - It does not enable playarr-update-check.timer (shipped disabled by
#     design - see that file's comments).
# Starting the service is a separate, explicit step an operator takes after
# reviewing /etc/playarr/playarr.env - see the printed instructions at
# the end of this script.
#
# Usage:
#   sudo ./install.sh [path-to-playarr-server-binary]
#
# If no binary path is given, defaults to ./playarr-server relative to this
# script's directory, then ../playarr-server (the release tarball layout:
# the binary and web/ at the top, this script under systemd/).

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"

if [[ -n "${1:-}" ]]; then
  BINARY_SRC="$1"
elif [[ -f "${SCRIPT_DIR}/playarr-server" ]]; then
  BINARY_SRC="${SCRIPT_DIR}/playarr-server"
else
  BINARY_SRC="${SCRIPT_DIR}/../playarr-server"
fi
WEB_SRC="$(dirname -- "${BINARY_SRC}")/web"
WEB_DEST="/var/lib/playarr/web"
INSTALL_BIN_DIR="/usr/local/bin"
INSTALL_BIN_PATH="${INSTALL_BIN_DIR}/playarr-server"
CONFIG_DIR="/etc/playarr"
ENV_FILE="${CONFIG_DIR}/playarr.env"
ENV_EXAMPLE="${SCRIPT_DIR}/playarr.env.example"
DATA_DIR="/var/lib/playarr"
LOG_DIR="/var/log/playarr"
UNIT_DIR="/etc/systemd/system"
SERVICE_USER="playarr"
SERVICE_GROUP="playarr"

UNIT_FILES=(
  "playarr.service"
  "playarr-update-check.service"
  "playarr-update-check.timer"
)

log() {
  printf '==> %s\n' "$1"
}

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "must be run as root (try: sudo $0 $*)"
  fi
}

require_linux_systemd() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    die "this script installs a systemd service and must be run on Linux (detected: $(uname -s))"
  fi
  command -v systemctl >/dev/null 2>&1 || die "systemctl not found - is this host running systemd?"
}

require_binary() {
  [[ -f "${BINARY_SRC}" ]] || die "playarr-server binary not found at ${BINARY_SRC} (pass a path as the first argument)"
  [[ -x "${BINARY_SRC}" ]] || die "${BINARY_SRC} is not executable"
}

ensure_user() {
  if id "${SERVICE_USER}" &>/dev/null; then
    log "system user '${SERVICE_USER}' already exists"
  else
    log "creating system user/group '${SERVICE_USER}'"
    useradd \
      --system \
      --user-group \
      --home-dir "${DATA_DIR}" \
      --no-create-home \
      --shell /usr/sbin/nologin \
      "${SERVICE_USER}"
  fi
}

ensure_dirs() {
  log "creating ${CONFIG_DIR}, ${DATA_DIR}, ${LOG_DIR}"
  install -d -o root -g "${SERVICE_GROUP}" -m 0750 "${CONFIG_DIR}"
  install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0750 "${DATA_DIR}"
  install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0750 "${LOG_DIR}"
}

install_binary() {
  log "installing binary: ${BINARY_SRC} -> ${INSTALL_BIN_PATH}"
  install -o root -g root -m 0755 "${BINARY_SRC}" "${INSTALL_BIN_PATH}"
}

install_web() {
  if [[ ! -f "${WEB_SRC}/index.html" ]]; then
    log "no web/ directory beside the binary, skipping the Admin UI (the server will serve the API only)"
    return
  fi
  log "installing Admin UI: ${WEB_SRC} -> ${WEB_DEST}"
  rm -rf "${WEB_DEST}"
  cp -r "${WEB_SRC}" "${WEB_DEST}"
  chown -R root:root "${WEB_DEST}"
  chmod -R u=rwX,go=rX "${WEB_DEST}"
}

seed_env_file() {
  if [[ -f "${ENV_FILE}" ]]; then
    log "${ENV_FILE} already exists, leaving it untouched"
    return
  fi
  if [[ ! -f "${ENV_EXAMPLE}" ]]; then
    log "warning: ${ENV_EXAMPLE} not found, skipping env file seed"
    return
  fi
  log "seeding ${ENV_FILE} from playarr.env.example (edit it before starting the service)"
  install -o root -g "${SERVICE_GROUP}" -m 0640 "${ENV_EXAMPLE}" "${ENV_FILE}"
}

install_units() {
  for unit in "${UNIT_FILES[@]}"; do
    local src="${SCRIPT_DIR}/${unit}"
    [[ -f "${src}" ]] || die "unit file not found: ${src}"
    log "installing ${unit} -> ${UNIT_DIR}/${unit}"
    install -o root -g root -m 0644 "${src}" "${UNIT_DIR}/${unit}"
  done
}

reload_systemd() {
  log "running systemctl daemon-reload"
  systemctl daemon-reload
}

print_next_steps() {
  cat <<EOF

Install complete. Nothing has been enabled or started.

Next steps:
  1. Review and fill in real values:
       sudoedit ${ENV_FILE}
     (at minimum DATABASE_URL is required; for a single host use
      sqlite:///var/lib/playarr/playarr.db)

  2. Enable and start the main service:
       sudo systemctl enable --now playarr.service

  3. Check it came up healthy:
       systemctl status playarr.service
       journalctl -u playarr.service -f

  4. Optional: opt in to the (check-only, disabled-by-default) daily
     update-check timer:
       sudo systemctl enable --now playarr-update-check.timer

EOF
}

main() {
  require_root "$@"
  require_linux_systemd
  require_binary
  ensure_user
  ensure_dirs
  install_binary
  install_web
  seed_env_file
  install_units
  reload_systemd
  print_next_steps
}

main "$@"
