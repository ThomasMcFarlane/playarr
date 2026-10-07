#!/usr/bin/env bash
# Tests scripts/ci/check-layout-owner-request.sh against synthetic changes and PR bodies.
set -uo pipefail
cd "$(dirname "$0")"
gate=./check-layout-owner-request.sh
fail=0
run() { # name expected-exit changed body [event] [ref]
  local name=$1 want=$2 changed=$3 body=$4 event=${5:-pull_request} ref=${6:-feature}
  CHANGED_FILES="$changed" PR_BODY="$body" EVENT_NAME="$event" GITHUB_REF_NAME="$ref" "$gate" >/dev/null 2>&1
  local got=$?
  if [ "$got" != "$want" ]; then echo "FAIL $name: exit $got, wanted $want"; fail=1; else echo "ok   $name"; fi
}
CSS=clients/tv-web/web/src/styles/page-layout.css
PILL=clients/tv-web/web/src/components/shell/ActionPill.tsx
TRAILER='Layout-Change: owner request 2026-10-07, reference filters-0930'
run "no look file" 0 $'clients/tv-web/web/src/pages/Library.tsx\nREADME.md' ""
run "css without trailer" 1 "$CSS" "Restyles things"
run "pill without trailer" 1 "$PILL" "Consistency pass"
run "css with trailer" 0 "$CSS" $'Summary\n\n'"$TRAILER"
run "trailer with CRLF" 0 "$CSS" "$(printf 'Summary\r\n%s\r\n' "$TRAILER")"
run "pin image without trailer" 1 "docs/parity/web/layout/tv/dark/header-canonical.png" "x"
run "trailer without a reference" 1 "$CSS" "Layout-Change: owner request 2026-10-07, reference "
run "trailer without a date" 1 "$CSS" "Layout-Change: owner request, reference filters-0930"
run "trailer indented (not a trailer line)" 1 "$CSS" "  $TRAILER"
run "android page file without trailer" 1 "clients/android/core-designsystem/src/main/kotlin/io/playarr/shared/designsystem/page/PlayarrActionPill.kt" "x"
run "android pure logic file" 0 "clients/android/core-designsystem/src/main/kotlin/io/playarr/shared/designsystem/page/PageTokens.kt" "x"
run "golden without trailer" 1 "clients/android/core-designsystem/src/test/snapshots/header_tv_light.png" "x"
run "push to main is skipped" 0 "$CSS" "x" push main
run "main dispatch is skipped" 0 "$CSS" "x" workflow_dispatch main
run "train dispatch checks the body" 1 "$CSS" "x" workflow_dispatch feature
run "train dispatch with trailer" 0 "$CSS" "$TRAILER" workflow_dispatch feature
exit $fail
