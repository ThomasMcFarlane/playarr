#!/usr/bin/env bash
# Tests scripts/ci/android-main-version.sh.
set -uo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail=0
props() { printf 'PLAYARR_VERSION_NAME=%s\n' "$1" > "$tmp/version.properties"; }
check() { # name expected-output args...
  local name=$1 want=$2; shift 2
  local got
  got=$(./android-main-version.sh "$tmp/version.properties" "$@" 2>/dev/null | tr '\n' ' ')
  if [ "$got" != "$want" ]; then echo "FAIL $name: '$got', wanted '$want'"; fail=1; else echo "ok   $name"; fi
}
props 0.3.0
check "name and code" "name=0.3.0-main.1278 code=30001278 " 1278
check "above the 0.3.0 release code" "name=0.3.0-main.1 code=30000001 " 1 3000
check "rises with every commit" "name=0.3.0-main.1279 code=30001279 " 1279
props 0.4.2
check "minor and patch weigh in" "name=0.4.2-main.5 code=40200005 " 5
props 3.0.0
check "major above 2 is refused" "" 5
props 0.100.0
check "minor above 99 is refused" "" 5
props not-a-version
check "bad version is refused" "" 5
props 0.3.0
check "commit count must be a number" "" abc
check "commit count is bounded" "" 100000
check "code must beat the latest release" "" 1 30001278
if [ "$fail" != 0 ]; then exit 1; fi
