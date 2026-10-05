#!/usr/bin/env bash
#
# server-release-owner-setup.sh - the one owner-only step for Playarr Server releases.
# Releases are published to GitHub Releases only, so no object-storage token is needed.
#
# GHCR visibility. GitHub's API cannot change package visibility, so this prints the one
# click needed to make ghcr.io/thomasmcfarlane/playarr-server public.
set -euo pipefail

"$(dirname "$0")/ghcr-make-public.sh" || true
