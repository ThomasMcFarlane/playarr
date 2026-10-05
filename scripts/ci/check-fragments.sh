#!/usr/bin/env bash
# Fails a pull request that edits CHANGELOG.md or TASKS.md directly. Those two files are conflict
# hotspots, so PRs add fragment files (changelog.d/, tasks.d/) and the merge train folds them in
# (commit subject "chore(train): fold fragments"). Also validates fragment syntax when node exists.
#
# Env: BASE_REF (default main). Looks only at the PR's own non-merge commits.
set -euo pipefail
cd "$(dirname "$0")/../.."
base="${BASE_REF:-main}"
git fetch -q --no-tags origin "$base"
head=$(git rev-parse HEAD^2 2>/dev/null || git rev-parse HEAD)
bad=""
for c in $(git rev-list --no-merges "origin/$base..$head"); do
  case "$(git log -1 --format=%s "$c")" in "chore(train): fold fragments"*) continue ;; esac
  # Key mode: the train squashes the branch (with the folded fragments) into one commit it authors.
  [ "$(git log -1 --format=%ae "$c")" = "thomas@mcfarlane.email" ] && continue
  if git diff-tree --no-commit-id --name-only -r "$c" | grep -qxE 'CHANGELOG\.md|TASKS\.md'; then
    bad="$bad$(git log -1 --format='%h %s' "$c")"$'\n'
  fi
done
if [ -n "$bad" ]; then
  echo "::error::Do not edit CHANGELOG.md or TASKS.md in a PR; add changelog.d/<slug>.<category>.md and tasks.d/<row>.md fragments instead (see AGENTS.md). Offending commits:"
  printf '%s' "$bad"
  exit 1
fi
if command -v node >/dev/null; then node scripts/fold-fragments.mjs --check; fi
