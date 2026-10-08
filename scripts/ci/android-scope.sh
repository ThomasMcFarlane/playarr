#!/usr/bin/env bash
# Decide how much of the Android build CI must run for a change.
#
# Prints key=value lines (for $GITHUB_OUTPUT):
#   android=true|false
#   android_tasks="<gradle tasks>"      (empty when android=false)
#
# - Pushes to main, the nightly schedule and dispatches on main run the full `build` (all modules,
#   both flavours, release variants, lint on every variant).
# - A pull request (or a dispatch on a PR branch) with no Android-relevant change skips the job.
# - Otherwise a pull request runs the unit tests and lint of the affected library modules (changed
#   modules plus every module that depends on them) and, always, the app's sideload debug unit
#   tests, assemble and lint. The Play flavour is added only when its own sources, its tests or
#   the app/build configuration change. Unchanged modules are Gradle build-cache hits anyway.
#
# Inputs: CHANGED_FILES (newline list, for tests) or EVENT_NAME/BASE_REF to diff against origin.
set -euo pipefail
cd "$(dirname "$0")/../.."

full() { echo "android=true"; echo "android_tasks=build"; exit 0; }

if [ -z "${CHANGED_FILES:-}" ]; then
  case "${EVENT_NAME:-}" in
    pull_request | workflow_dispatch) ;;
    *) full ;;
  esac
  [ "${EVENT_NAME:-}" = workflow_dispatch ] && [ "${GITHUB_REF_NAME:-}" = main ] && full
  base="${BASE_REF:-main}"
  git fetch -q --no-tags origin "$base" 2>/dev/null || full
  if [ "${EVENT_NAME:-}" = pull_request ]; then head=$(git rev-parse HEAD^2 2>/dev/null || git rev-parse HEAD); else head=$(git rev-parse HEAD); fi
  CHANGED_FILES=$(git diff --name-only "origin/$base...$head") || full
fi

A=clients/android
# "<module> <dependency>" per line, from project(":x") references in each module's build script.
edges=$(
  for m in $A/*/build.gradle.kts; do
    mod=$(basename "$(dirname "$m")")
    grep -o 'project(":[a-z0-9-]*")' "$m" | sed -E 's/project\(":([a-z0-9-]*)"\)/\1/' | while read -r dep; do echo "$mod $dep"; done
  done
)

seeds=""
relevant=false
play=false
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    $A/*.md | $A/docs/* | $A/fastlane/* | $A/tools/*) ;;
    $A/app/src/play/* | $A/app/src/testPlay/* | $A/app/build.gradle.kts | $A/app/proguard-rules.pro) relevant=true; play=true; seeds="$seeds app" ;;
    $A/app/*) relevant=true; seeds="$seeds app" ;;
    $A/core-*/*) relevant=true; m=${f#$A/}; seeds="$seeds ${m%%/*}"
      case "$f" in */build.gradle.kts) seeds="$seeds app"; play=true ;; esac ;;
    # Root build files, version catalog, wrapper, shared properties: every module is affected.
    $A/*) relevant=true; seeds="$seeds app $(ls -d $A/core-*/ | xargs -n1 basename | tr '\n' ' ')"; play=true ;;
    .github/workflows/ci.yml | scripts/ci/android-scope.sh) relevant=true; seeds="$seeds app" ;;
  esac
done <<<"$CHANGED_FILES"

if [ "$relevant" = false ]; then
  echo "android=false"; echo "android_tasks="; exit 0
fi

# Reverse-dependency closure: a module that depends on a changed module is affected.
set=" app $seeds "
changed=1
while [ "$changed" = 1 ]; do
  changed=0
  while read -r mod dep; do
    [ -z "$mod" ] && continue
    case "$set" in *" $dep "*) case "$set" in *" $mod "*) ;; *) set="$set$mod "; changed=1 ;; esac ;; esac
  done <<<"$edges"
done

tasks=":app:testSideloadDebugUnitTest :app:assembleSideloadDebug :app:lintSideloadDebug"
[ "$play" = true ] && tasks="$tasks :app:testPlayDebugUnitTest :app:assemblePlayDebug :app:lintPlayDebug"
for m in $(tr ' ' '\n' <<<"$set" | sort -u); do
  [ "$m" = app ] && continue
  tasks=":$m:testDebugUnitTest :$m:lintDebug $tasks"
  # core-designsystem holds the Roborazzi goldens of the shared page components (docs/design/page-layout.md 7.3).
  [ "$m" = core-designsystem ] && tasks=":$m:verifyRoborazziDebug $tasks"
done
echo "android=true"
echo "android_tasks=$tasks"
