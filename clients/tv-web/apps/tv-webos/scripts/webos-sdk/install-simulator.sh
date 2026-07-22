#!/usr/bin/env bash
set -euo pipefail

# Installs a webOS TV Simulator zip into the layout ares-launch expects
# under $LG_WEBOS_TV_SDK_HOME (LG_WEBOS_TV_SDK_HOME/Simulator/<version>/).
#
# The zip must be downloaded manually first: the download page
# (https://webostv.developer.lge.com/develop/tools/simulator-installation)
# is a JS-rendered SPA gated behind a click-through EULA with no stable
# direct-download URL, so this step can't be scripted.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./env.sh
source "$SCRIPT_DIR/env.sh"

zip_path="${1:?Usage: install-simulator.sh <path-to-webOS_TV_*_Simulator_*_linux.zip>}"
[ -f "$zip_path" ] || { echo "No such file: $zip_path" >&2; exit 1; }

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

unzip -q "$zip_path" -d "$work_dir"
appimage="$(find "$work_dir" -iname '*.appimage' -type f | head -1)"
[ -n "$appimage" ] || { echo "No .AppImage found inside $zip_path" >&2; exit 1; }

appimage_name="$(basename "$appimage")"
version_dir="${appimage_name%.*}"
target_dir="$LG_WEBOS_TV_SDK_HOME/Simulator/$version_dir"
mkdir -p "$target_dir"
cp "$appimage" "$target_dir/$appimage_name"
chmod +x "$target_dir/$appimage_name"

echo "Installed: $target_dir/$appimage_name"
echo "Launch it with: scripts/webos-sdk/launch-simulator.sh"
