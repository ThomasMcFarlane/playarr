#!/usr/bin/env bash
# Decides whether this run may deploy playarr.app. Writes deploy=true|false to
# $GITHUB_OUTPUT and always exits 0 so a stale deploy is a logged skip, never a
# red run. A run skips only when its commit is an ancestor of the commit already
# live (read from https://playarr.app/build-info.json), so an older run can
# never overwrite a newer build. It does NOT skip merely because origin/main has
# moved on: CI takes longer than the gap between merges, so skipping on "not
# HEAD" starved the deploy and left playarr.app stale. Runs are serialised by
# the deploy-web-prod concurrency group, so each deploys in turn.
set -uo pipefail

sha="${DEPLOY_SHA:?DEPLOY_SHA is required}"
out="${GITHUB_OUTPUT:-/dev/null}"
skip() { echo "SKIP deploy of ${sha}: $1"; echo "deploy=false" >>"$out"; exit 0; }

git fetch --quiet origin main || skip "cannot fetch origin/main; refusing to guess"
head_sha="$(git rev-parse origin/main)"

live_sha=""
body="$(curl -fsS -m 20 -H 'Cache-Control: no-cache' "https://playarr.app/build-info.json?t=$(date +%s)" 2>/dev/null || true)"
if [ -n "$body" ]; then
  live_sha="$(printf '%s' "$body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s).sha;if(/^[0-9a-f]{40}$/.test(v))process.stdout.write(v)}catch{}})')"
fi

echo "deploying: ${sha}"
echo "origin/main HEAD: ${head_sha}"
echo "live: ${live_sha:-unknown (no build-info.json yet)}"

if [ -n "$live_sha" ] && [ "$live_sha" != "$sha" ]; then
  if git cat-file -e "${live_sha}^{commit}" 2>/dev/null && git merge-base --is-ancestor "$sha" "$live_sha"; then
    skip "it is an ancestor of the live build ${live_sha}"
  fi
fi
echo "deploy=true" >>"$out"
