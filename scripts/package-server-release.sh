#!/usr/bin/env bash
#
# package-server-release.sh - pack one Playarr Server release tarball.
#
# Usage:
#   scripts/package-server-release.sh <version> <amd64|arm64> <binary> <web-dir> <out-dir>
#
# Produces <out-dir>/playarr-server-<version>-linux-<arch>.tar.gz and a matching
# .sha256 file. The archive unpacks to playarr-server-<version>-linux-<arch>/
# containing the binary, the Admin UI (web/, which the binary finds beside
# itself or via PLAYARR_WEB_ASSETS_DIR), LICENSE, a short README and the example
# systemd units with install.sh.
set -euo pipefail

[[ $# -eq 5 ]] || { sed -n '3,12p' "$0" >&2; exit 2; }
version="$1" arch="$2" binary="$3" web="$4" out="$5"
case "$arch" in amd64|arm64) ;; *) echo "arch must be amd64 or arm64" >&2; exit 2 ;; esac
[[ -x "$binary" ]] || { echo "binary not found or not executable: $binary" >&2; exit 1; }
[[ -f "$web/index.html" ]] || { echo "web dir has no index.html: $web" >&2; exit 1; }

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
name="playarr-server-${version}-linux-${arch}"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
dir="$stage/$name"
mkdir -p "$dir/systemd" "$out"

install -m 0755 "$binary" "$dir/playarr-server"
cp -r "$web" "$dir/web"
install -m 0644 "$root/LICENSE" "$dir/LICENSE"
for f in playarr.service playarr-update-check.service playarr-update-check.timer playarr.env.example; do
  # The source repository is private; point Documentation= at the public hub.
  sed 's#^Documentation=.*#Documentation=https://playarr.app/clients/server#' \
    "$root/infra/systemd/$f" > "$dir/systemd/$f"
  chmod 0644 "$dir/systemd/$f"
done
install -m 0755 "$root/infra/systemd/install.sh" "$dir/systemd/install.sh"

cat > "$dir/README.txt" <<README
Playarr Server ${version} (linux-${arch})

Contents
  playarr-server   the server binary (API and worker in one process)
  web/             Playarr Admin UI, served by the binary on the same port
  systemd/         example units, env template and install.sh
  LICENSE          MIT licence

Requirements
  64-bit Linux on ${arch}, glibc 2.39 or newer with libssl3 (Debian 13,
  Ubuntu 24.04 or newer).
  ffmpeg and ffprobe on the server's PATH (thumbnails, probing, transcoding).

Quick start (systemd)
  sudo ./systemd/install.sh
  sudoedit /etc/playarr/playarr.env     # DATABASE_URL=sqlite:///var/lib/playarr/playarr.db
  sudo systemctl enable --now playarr.service
  curl http://127.0.0.1:8484/healthz

Quick start (foreground)
  mkdir -p data && DATABASE_URL=sqlite://\$PWD/data/playarr.db ./playarr-server serve

The Admin UI is found in web/ beside the binary; set PLAYARR_WEB_ASSETS_DIR to
serve it from elsewhere. Docs and clients: https://playarr.app/clients/server
README

tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='2026-01-01 00:00:00' \
  -C "$stage" -czf "$out/$name.tar.gz" "$name"
(cd "$out" && sha256sum "$name.tar.gz" > "$name.tar.gz.sha256")
echo "$out/$name.tar.gz"
