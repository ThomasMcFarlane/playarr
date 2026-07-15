#!/usr/bin/env bash
#
# install.sh - install (but do NOT enable or start) the Streamarr systemd
# service on a Linux host.
#
# What this script does:
#   1. Creates the streamarr system user/group (if missing).
#   2. Creates /etc/streamarr, /var/lib/streamarr, /var/log/streamarr with
#      correct ownership/permissions.
#   3. Copies the streamarr binary to /usr/local/bin/streamarr.
#   4. Seeds /etc/streamarr/streamarr.env from streamarr.env.example if it
#      doesn't already exist (never overwrites an existing env file).
#   5. Copies the three unit files to /etc/systemd/system/.
#   6. Runs `systemctl daemon-reload`.
#
# What this script deliberately does NOT do:
#   - It does not run `systemctl enable` or `systemctl start` on anything.
#   - It does not enable streamarr-update-check.timer (shipped disabled by
#     design - see that file's comments).
# Starting the service is a separate, explicit step an operator takes after
# reviewing /etc/streamarr/streamarr.env - see the printed instructions at
# the end of this script.
#
# Usage:
#   sudo ./install.sh [path-to-streamarr-binary]
#
# If no binary path is given, defaults to ./streamarr relative to this
# script's directory.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"

BINARY_SRC="${1:-${SCRIPT_DIR}/streamarr}"
INSTALL_BIN_DIR="/usr/local/bin"
INSTALL_BIN_PATH="${INSTALL_BIN_DIR}/streamarr"
CONFIG_DIR="/etc/streamarr"
ENV_FILE="${CONFIG_DIR}/streamarr.env"
ENV_EXAMPLE="${SCRIPT_DIR}/streamarr.env.example"
DATA_DIR="/var/lib/streamarr"
LOG_DIR="/var/log/streamarr"
UNIT_DIR="/etc/systemd/system"
SERVICE_USER="streamarr"
SERVICE_GROUP="streamarr"

UNIT_FILES=(
  "streamarr.service"
  "streamarr-update-check.service"
  "streamarr-update-check.timer"
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
  [[ -f "${BINARY_SRC}" ]] || die "streamarr binary not found at ${BINARY_SRC} (pass a path as the first argument)"
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

seed_env_file() {
  if [[ -f "${ENV_FILE}" ]]; then
    log "${ENV_FILE} already exists, leaving it untouched"
    return
  fi
  if [[ ! -f "${ENV_EXAMPLE}" ]]; then
    log "warning: ${ENV_EXAMPLE} not found, skipping env file seed"
    return
  fi
  log "seeding ${ENV_FILE} from streamarr.env.example (edit it before starting the service)"
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
     (at minimum DATABASE_URL and REDIS_URL are required)

  2. Enable and start the main service:
       sudo systemctl enable --now streamarr.service

  3. Check it came up healthy:
       systemctl status streamarr.service
       journalctl -u streamarr.service -f

  4. Optional: opt in to the (check-only, disabled-by-default) daily
     update-check timer:
       sudo systemctl enable --now streamarr-update-check.timer

EOF
}

main() {
  require_root "$@"
  require_linux_systemd
  require_binary
  ensure_user
  ensure_dirs
  install_binary
  seed_env_file
  install_units
  reload_systemd
  print_next_steps
}

main "$@"
