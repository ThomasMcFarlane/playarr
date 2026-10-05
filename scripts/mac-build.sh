#!/usr/bin/env bash
#
# scripts/mac-build.sh
#
# Builds/tests the iOS and tvOS clients on a remote Mac over SSH, since Xcode
# and xcodebuild only run on macOS. The Mac is reached via its Tailscale
# address (see ~/.ssh/config entry `mac-builder`, or set MAC_HOST/MAC_USER
# below), not via any container/VM on this workstation.
#
# Usage:
#   ./scripts/mac-build.sh ios build [destination]
#   ./scripts/mac-build.sh ios test [destination]
#   ./scripts/mac-build.sh appletv build [destination]
#   ./scripts/mac-build.sh appletv test [destination]
#
# `destination` defaults to a simulator for each platform; pass an
# xcodebuild -destination string to override, e.g.:
#   ./scripts/mac-build.sh ios test "platform=iOS Simulator,name=iPhone 16"
set -euo pipefail

MAC_HOST="${MAC_HOST:?set MAC_HOST to the macOS build host (address or SSH alias)}"
MAC_USER="${MAC_USER:-$USER}"
MAC_KEY="${MAC_KEY:-$HOME/.ssh/id_mac_builder}"
REMOTE_DIR="${REMOTE_DIR:-~/streamarr-mac-build}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

target="${1:?usage: mac-build.sh <ios|appletv> <build|test> [destination]}"
action="${2:?usage: mac-build.sh <ios|appletv> <build|test> [destination]}"

case "$target" in
  ios)
    project_dir="clients/ios"
    scheme="PlayarrApp"
    destination="${3:-platform=iOS Simulator,name=iPhone 17}"
    ;;
  appletv)
    project_dir="clients/apple-tv"
    scheme="PlayarrTV"
    destination="${3:-platform=tvOS Simulator,name=Apple TV}"
    ;;
  *)
    echo "unknown target: $target (expected ios or appletv)" >&2
    exit 1
    ;;
esac

case "$action" in
  build) xcodebuild_action="build" ;;
  test)  xcodebuild_action="test" ;;
  *)
    echo "unknown action: $action (expected build or test)" >&2
    exit 1
    ;;
esac

ssh_opts=(-i "$MAC_KEY" -o BatchMode=yes)

echo "==> syncing clients/ to $MAC_USER@$MAC_HOST:$REMOTE_DIR"
rsync -az --delete \
  -e "ssh ${ssh_opts[*]}" \
  --exclude '.build' \
  --exclude 'DerivedData' \
  --exclude 'xcuserdata' \
  --exclude '*.xcworkspace/xcuserdata' \
  --exclude 'android/app/build' \
  --exclude 'android/.gradle' \
  --exclude 'android/**/build' \
  "$REPO_ROOT/clients/" "$MAC_USER@$MAC_HOST:$REMOTE_DIR/clients/"

echo "==> running xcodebuild $xcodebuild_action for $scheme ($destination)"
# shellcheck disable=SC2029
ssh "${ssh_opts[@]}" "$MAC_USER@$MAC_HOST" \
  "cd $REMOTE_DIR/$project_dir && xcodebuild -scheme '$scheme' -destination '$destination' $xcodebuild_action"
