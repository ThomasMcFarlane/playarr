#!/usr/bin/env bash
set -euo pipefail

# Downloads LG's official prebuilt webOS OSE qemux86-64 disk image from
# GitHub Releases. Unlike the TV Simulator, this is a stable, directly
# downloadable asset with no browser/EULA gate, so it's safe to script.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./env.sh
source "$SCRIPT_DIR/env.sh"

version="${1:-v2.28.0}"
version_no_v="${version#v}"
version_dashed="${version_no_v//./-}"
archive_name="webos-ose-${version_dashed}-qemux86-64.tar.bz2"
url="https://github.com/webosose/build-webos/releases/download/${version}/${archive_name}"

image_dir="$WEBOS_OSE_EMULATOR_HOME/images"
vmdk="$image_dir/webos-image-qemux86-64.wic.vmdk"

if [ -f "$vmdk" ]; then
  echo "Already installed: $vmdk"
  exit 0
fi

mkdir -p "$image_dir"
archive="$image_dir/$archive_name"
echo "Downloading $url"
curl -fL --progress-bar -o "$archive" "$url"
tar xjf "$archive" -C "$image_dir"
rm -f "$archive"

[ -f "$vmdk" ] || { echo "Extraction did not produce $vmdk -- check archive contents." >&2; exit 1; }
echo "Installed: $vmdk"
echo "Boot it with: scripts/webos-sdk/launch-ose-emulator.sh (after installing qemu -- see README)"
