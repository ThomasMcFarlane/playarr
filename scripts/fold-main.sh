#!/usr/bin/env bash
# Folds pending tasks.d/ and changelog.d/ fragments into TASKS.md and CHANGELOG.md on main and pushes
# the result. Only the merge train folds on a normal landing; this covers pull requests merged directly
# (`gh pr merge --squash`) and the board-sync fragments, so the board never goes stale.
#
# Run from a checkout of main whose `origin` can push to main. Local commits ahead of origin/main
# (board-sync's fragment commit) are kept and rebased onto the current main before each attempt.
# The fold commit carries the train's identity and `Merge-Train: yes` trailer, the same route and
# marker the train uses, so check-fragments.sh exempts it.
#
# Env: DRY_RUN=true  fold locally, push nothing.   FOLD_BRANCH (default main).   FOLD_ATTEMPTS (default 4).
set -euo pipefail
cd "$(dirname "$0")/.."
br="${FOLD_BRANCH:-main}"
attempts="${FOLD_ATTEMPTS:-4}"
name="Thomas McFarlane"; email="thomas@mcfarlane.email"; trailer="Merge-Train: yes"

pending() { find tasks.d changelog.d -maxdepth 1 -name '*.md' ! -iname 'readme.md' 2>/dev/null | grep -q .; }

for i in $(seq 1 "$attempts"); do
  git fetch -q --no-tags origin "$br"
  git rebase -q "origin/$br" || { git rebase --abort 2>/dev/null || true; echo "fold-main: cannot rebase onto origin/$br" >&2; exit 1; }
  if pending; then
    node scripts/fold-fragments.mjs
    git add -A CHANGELOG.md TASKS.md changelog.d tasks.d
    git -c user.name="$name" -c user.email="$email" commit -q -m "chore(train): fold fragments for direct merges" -m "$trailer"
  elif [ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$br")" ]; then
    echo "fold-main: no pending fragments"; exit 0
  fi
  if [ "${DRY_RUN:-false}" = true ]; then echo "fold-main: dry run, not pushing"; exit 0; fi
  if git push -q origin "HEAD:$br"; then echo "fold-main: pushed $(git rev-parse --short HEAD)"; exit 0; fi
  echo "fold-main: push rejected (attempt $i), retrying on the new $br" >&2
  git reset -q --hard "HEAD~1"
done
echo "fold-main: gave up after $attempts attempts" >&2
exit 1
