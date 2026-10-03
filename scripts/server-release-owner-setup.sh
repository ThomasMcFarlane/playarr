#!/usr/bin/env bash
#
# server-release-owner-setup.sh - the two owner-only steps for Playarr Server releases.
# Run it yourself; it needs your interactive gh login and a Cloudflare token.
#
# 1. R2 upload token. Create a Cloudflare API token (My Profile -> API Tokens -> Create
#    Custom Token) with "Account / Workers R2 Storage / Edit" for the Thomas McFarlane account,
#    then paste it when asked. It is stored as CLOUDFLARE_R2_API_TOKEN in the release-android
#    environment, which is where the release workflow reads it.
# 2. GHCR visibility. GitHub's API cannot change package visibility, so this prints the one
#    click needed to make ghcr.io/thomasmcfarlane/playarr-server public.
set -euo pipefail
repo="ThomasMcFarlane/playarr"

read -r -s -p "Cloudflare R2 API token (input hidden, Enter to skip): " token; echo
if [[ -n "$token" ]]; then
  printf '%s' "$token" | gh secret set CLOUDFLARE_R2_API_TOKEN --env release-android -R "$repo"
  echo "Stored CLOUDFLARE_R2_API_TOKEN in release-android."
fi

"$(dirname "$0")/ghcr-make-public.sh" || true
