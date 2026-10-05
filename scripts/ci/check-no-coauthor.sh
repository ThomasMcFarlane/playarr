#!/usr/bin/env bash
# Fails a pull request when any of its commits (base..head) carries a `Co-authored-by:` trailer.
# Owner rule: commits here are authored by Thomas McFarlane alone; agents must never add the
# trailer. Match is case-insensitive and anchored to the start of a message line.
#
# Env: BASE_REF (default main). Looks at every commit of the PR, merge commits included.
set -euo pipefail
cd "$(dirname "$0")/../.."
base="${BASE_REF:-main}"
git fetch -q --no-tags origin "$base"
head=$(git rev-parse HEAD^2 2>/dev/null || git rev-parse HEAD)
bad=""
for c in $(git rev-list "origin/$base..$head"); do
  if git log -1 --format=%B "$c" | grep -qiE '^[[:space:]]*co-authored-by[[:space:]]*:'; then
    bad="$bad$(git log -1 --format='%h %s' "$c")"$'\n'
  fi
done
if [ -n "$bad" ]; then
  echo "::error::Co-authored-by trailers are forbidden. Rewrite these commits without the trailer (git rebase -i, reword, then force-push with lease). Offending commits:"
  printf '%s' "$bad"
  exit 1
fi
echo "No Co-authored-by trailers in $base..$head"
