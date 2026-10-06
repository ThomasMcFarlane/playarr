#!/usr/bin/env bash
#
# ghcr-make-public.sh - check whether the Playarr container package is
# public, and print the one manual step if it is not.
#
# GitHub's REST API cannot change a package's visibility, so a package created
# by the release workflow stays private until its owner flips it once in the
# web UI. After that every later release stays public.
#
# Usage: scripts/ghcr-make-public.sh [owner] [package]
set -euo pipefail

owner="${1:-ThomasMcFarlane}"
package="${2:-playarr}"
image="ghcr.io/$(echo "$owner" | tr '[:upper:]' '[:lower:]')/${package}"

vis="$(gh api "users/${owner}/packages/container/${package}" --jq .visibility 2>/dev/null || echo missing)"
echo "package ${image}: ${vis}"

case "$vis" in
  public) exit 0 ;;
  missing) echo "The package does not exist yet. Publish the package first." >&2; exit 1 ;;
esac

cat <<TEXT

Make it public (one click, one time):
  1. Open https://github.com/users/${owner}/packages/container/${package}/settings
  2. Danger Zone -> Change visibility -> Public -> type "${package}" -> confirm.

Then verify an anonymous pull:
  DOCKER_CONFIG=\$(mktemp -d) docker pull ${image}:latest
TEXT
exit 1
