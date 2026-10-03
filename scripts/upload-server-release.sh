#!/usr/bin/env bash
#
# upload-server-release.sh - upload a packed Playarr Server release to the
# private R2 bucket served by the playarr.app Worker under /downloads/server/.
#
# Usage: scripts/upload-server-release.sh <dist-dir> <version> [prerelease=false]
#
# <dist-dir> holds the release workflow's output: playarr-server-<version>-linux-*.tar.gz
# (+ .sha256), playarr-server-<version>-SHA256SUMS and latest.json. Versioned keys are
# always written; the stable "latest" aliases and latest.json only for stable releases.
#
# Credentials: CLOUDFLARE_API_TOKEN (Workers R2 Storage Edit) and CLOUDFLARE_ACCOUNT_ID in the
# environment, or an existing `wrangler login` plus CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail

[[ $# -ge 2 ]] || { sed -n '3,13p' "$0" >&2; exit 2; }
dist="$1" version="$2" prerelease="${3:-false}"
bucket="${R2_BUCKET:-playarr-client-downloads}"

put() { npx --yes wrangler@4 r2 object put "$bucket/$1" --file "$2" --content-type "$3" --remote; }

for f in "$dist"/playarr-server-"$version"-linux-*.tar.gz; do
  put "server/releases/$version/$(basename "$f")" "$f" application/gzip
  put "server/releases/$version/$(basename "$f").sha256" "$f.sha256" text/plain
done
put "server/releases/$version/playarr-server-$version-SHA256SUMS" "$dist/playarr-server-$version-SHA256SUMS" text/plain

if [[ "$prerelease" != "true" ]]; then
  alias_dir="$(mktemp -d)"
  trap 'rm -rf "$alias_dir"' EXIT
  for arch in amd64 arm64; do
    tarball="$dist/playarr-server-$version-linux-$arch.tar.gz"
    put "server/playarr-server-linux-$arch.tar.gz" "$tarball" application/gzip
    # The alias checksum names the alias file so `sha256sum -c` works after download.
    sed "s#playarr-server-$version-linux-$arch.tar.gz#playarr-server-linux-$arch.tar.gz#" \
      "$tarball.sha256" > "$alias_dir/$arch.sha256"
    put "server/playarr-server-linux-$arch.tar.gz.sha256" "$alias_dir/$arch.sha256" text/plain
  done
  put "server/latest.json" "$dist/latest.json" application/json
fi
