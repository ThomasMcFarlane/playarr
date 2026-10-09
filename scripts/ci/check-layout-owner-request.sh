#!/usr/bin/env bash
# Owner-request gate for the shared page layout look (docs/design/page-layout.md, section 7.4).
#
# Changing the look of a shared layout component needs an explicit owner request that names the reference. A PR that
# changes a look file must carry this trailer line in its body:
#
#   Layout-Change: owner request <YYYY-MM-DD>, reference <screen id or component>
#
# A parity fix, a "consistency" pass or a request about one page is not such a request. Agents must not add the trailer
# without a quoted owner request.
#
# Look files: every web stylesheet (styles/*.css, which holds the focus ring, card focus, edge fades and the dark scrim,
# and pages/*.css such as Calendar, Folders and Clients), the shared layout components (PageLayout, PageHeader,
# PageActions, ActionPill, ScrollArea, States, Drawer, Skeleton, MasterDetail, ShellActionColumn, PageShell, PeriodPicker,
# ViewToggle, FiltersDrawer, TvEmptyState, TvStage and the icon map), the committed layout references and pins, and the
# Android page package and its goldens.
#
# Env: BASE_REF (default main); EVENT_NAME (default GITHUB_EVENT_NAME). The PR body comes from, in order, PR_BODY,
# the pull_request event payload (GITHUB_EVENT_PATH), or `gh pr list --head $GITHUB_REF_NAME` (merge-train runs are
# workflow_dispatch runs on the PR branch). CHANGED_FILES (newline separated) replaces the git diff, for the tests.
# Runs only for pull requests and train dispatches; pushes to main, nightly runs and main dispatches are skipped.
set -euo pipefail
cd "$(dirname "$0")/../.."

LOOK_FILES='^(clients/tv-web/web/src/styles/[^/]+\.css|clients/tv-web/web/src/pages/[^/]+\.css|clients/tv-web/web/src/components/shell/(ActionPill|PageActions|PageHeader|PageLayout|ScrollArea|States|icons|MasterDetail|ShellActionColumn|PageShell|PeriodPicker|Drawer|Skeleton|ViewToggle|FiltersDrawer)\.tsx|clients/tv-web/web/src/components/tv/(TvEmptyState|TvStage)\.tsx|docs/parity/web/layout/.*|clients/android/core-designsystem/src/main/kotlin/.*/designsystem/page/.*|clients/android/core-designsystem/src/test/snapshots/.*)$'
# Android page files that are pure logic (no look) and may change without the trailer.
LOGIC_ONLY='^clients/android/core-designsystem/src/main/kotlin/.*/designsystem/page/(PageTokens|PageRegistry|PageActionOrder)\.kt$'

event="${EVENT_NAME:-${GITHUB_EVENT_NAME:-pull_request}}"
case "$event" in
  pull_request | pull_request_target) ;;
  workflow_dispatch)
    if [ "${GITHUB_REF_NAME:-}" = main ]; then echo "Layout owner-request gate: main dispatch, skipped"; exit 0; fi
    # The merge train's batch stack (scripts/merge-train-batch.sh) holds several PRs, none of which owns the
    # branch. Each member passed this gate on its own head before it was stacked (a precondition of batching).
    if [ "${GITHUB_REF_NAME:-}" = train/batch ]; then echo "Layout owner-request gate: train batch, each member passed on its own head"; exit 0; fi
    ;;
  *) echo "Layout owner-request gate: $event, skipped"; exit 0 ;;
esac

if [ -n "${CHANGED_FILES+x}" ]; then
  changed="$CHANGED_FILES"
else
  base="${BASE_REF:-main}"
  git fetch -q --no-tags origin "$base"
  head=$(git rev-parse HEAD^2 2>/dev/null || git rev-parse HEAD)
  changed=$(git diff --name-only "origin/$base...$head")
fi

look=$(printf '%s\n' "$changed" | grep -E "$LOOK_FILES" | grep -vE "$LOGIC_ONLY" || true)
if [ -z "$look" ]; then
  echo "Layout owner-request gate: no shared layout look file changed"
  exit 0
fi

if [ -n "${PR_BODY+x}" ]; then
  body="$PR_BODY"
elif [ -n "${GITHUB_EVENT_PATH:-}" ] && [ "$event" != workflow_dispatch ]; then
  body=$(jq -r '.pull_request.body // ""' "$GITHUB_EVENT_PATH")
else
  body=$(gh pr list --repo "${GITHUB_REPOSITORY:?}" --head "${GITHUB_REF_NAME:?}" --state open --json body --jq '.[0].body // ""')
fi

if printf '%s\n' "$body" | tr -d '\r' | grep -qE '^Layout-Change: owner request [0-9]{4}-[0-9]{2}-[0-9]{2}, reference [^[:space:]].*$'; then
  echo "Layout owner-request gate: trailer present for:"
  printf '  %s\n' $look
  exit 0
fi

echo "::error::This PR changes the look of the shared page layout, which needs an explicit owner request that names the reference."
echo "Add this line to the PR body (only with a quoted owner request; a parity fix or consistency pass is not one):"
echo "  Layout-Change: owner request <YYYY-MM-DD>, reference <screen id or component>"
echo "Look files changed:"
printf '  %s\n' $look
exit 1
