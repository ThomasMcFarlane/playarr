#!/usr/bin/env bash
# Decide how much of the tv-web lint and typecheck CI must run for a change.
#
# Prints key=value lines (for $GITHUB_OUTPUT):
#   tv_web_filters=<space separated pnpm --filter selectors>   (empty: run everything)
#
# - Pushes, the nightly schedule and dispatches on main run everything.
# - A pull request whose changes under clients/tv-web are all inside workspace packages
#   (packages/*, apps/*, web, admin) selects each changed package plus everything that depends
#   on it, as `...{./<dir>}` directory selectors (no git history is needed to apply them).
# - Anything else (root manifests, lockfile, workspace file, base tsconfig, tooling, a script
#   change here, the workflow itself) runs everything.
#
# Inputs: CHANGED_FILES (newline list, for tests) or EVENT_NAME/BASE_REF to diff against origin.
set -euo pipefail
cd "$(dirname "$0")/../.."

full() { echo "tv_web_filters="; exit 0; }

if [ -z "${CHANGED_FILES:-}" ]; then
  [ "${EVENT_NAME:-}" = pull_request ] || full
  base="${BASE_REF:-main}"
  git fetch -q --no-tags origin "$base" 2>/dev/null || full
  head=$(git rev-parse HEAD^2 2>/dev/null || git rev-parse HEAD)
  CHANGED_FILES=$(git diff --name-only "origin/$base...$head") || full
fi

T=clients/tv-web
dirs=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    $T/packages/*/* | $T/apps/*/*)
      rest=${f#$T/}; d=$(cut -d/ -f1-2 <<<"$rest") ;;
    $T/web/* | $T/admin/*)
      rest=${f#$T/}; d=${rest%%/*} ;;
    $T/*.md | $T/PLAYARR_HANDOVER.md | $T/k8s/* | $T/deploy/*) continue ;;
    # The web header-button parity test reads the Apple clients' Swift sources: run the web package for them.
    clients/apple-tv/* | clients/ios/*) d=web ;;
    $T/* | .github/workflows/ci.yml | scripts/ci/tv-web-scope.sh) full ;;
    *) continue ;;
  esac
  case " $dirs " in *" $d "*) ;; *) dirs="$dirs $d" ;; esac
done <<<"$CHANGED_FILES"

out=""
for d in $dirs; do out="$out ...{./$d}"; done
echo "tv_web_filters=${out# }"
