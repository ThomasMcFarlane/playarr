#!/usr/bin/env bash
set -euo pipefail

# Launches an installed webOS TV Simulator AppImage directly, with the flags
# its own Linux docs require. ares-launch --simulator cannot pass these
# flags to the AppImage on modern Linux, so it isn't used here -- load the
# app via the Simulator's own UI instead (this script prints the dist/ path
# to open/drag-drop once the window is up).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./env.sh
source "$SCRIPT_DIR/env.sh"

sim_root="$LG_WEBOS_TV_SDK_HOME/Simulator"
if [ ! -d "$sim_root" ] || [ -z "$(ls -A "$sim_root" 2>/dev/null)" ]; then
  echo "No Simulator installed under $sim_root" >&2
  echo "Download one from https://webostv.developer.lge.com/develop/tools/simulator-installation" >&2
  echo "then run: scripts/webos-sdk/install-simulator.sh <downloaded.zip>" >&2
  exit 1
fi

if [ $# -ge 1 ]; then
  version_dir="$sim_root/$1"
  [ -d "$version_dir" ] || { echo "No such Simulator version dir: $version_dir" >&2; ls "$sim_root" >&2; exit 1; }
else
  version_dir="$(ls -dt "$sim_root"/*/ | head -1)"
fi

appimage="$(find "$version_dir" -iname '*.appimage' -type f | head -1)"
[ -n "$appimage" ] || { echo "No AppImage found in $version_dir" >&2; exit 1; }

app_dist="$(cd "$SCRIPT_DIR/../.." && pwd)/dist"

echo "Launching $appimage"
echo "Once it opens, use File > Open (or drag-and-drop) to load:"
echo "  $app_dist"
if [ ! -d "$app_dist" ]; then
  echo "  (doesn't exist yet -- run: pnpm --filter @streamarr-tv/app-webos run build)"
fi
echo

exec "$appimage" --ozone-platform=x11 --no-sandbox
