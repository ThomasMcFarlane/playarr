#!/usr/bin/env bash
# Lists remote branches that carry work nobody is tracking: no open pull request, no
# task-board reference (branch name or PR number in TASKS.md or tasks.d/) and commits
# that are not on main. Exits 1 when any exist, so the scheduled workflow fails and its
# summary names them. Untracked work once sat on a branch for months with no PR and no row.
#
# Cost: one `git fetch` and one `gh pr list` call (GraphQL, up to 1000 PRs), whatever the
# number of branches.
#
#   scripts/ci/check-untracked-branches.sh            # uses origin and GITHUB_REPOSITORY
#   PRS_JSON=prs.json scripts/ci/check-untracked-branches.sh   # offline: PR list from a file
#
# A branch counts as tracked when any of these holds:
#   - it has an open PR;
#   - its newest PR was merged and the branch has no commit after that PR's head;
#   - main contains its head;
#   - TASKS.md or tasks.d/ mention the whole branch name (not as part of a longer name), or `#<n>`/`/pull/<n>` of one of its PRs.
set -euo pipefail

remote="${REMOTE:-origin}"
main_ref="${MAIN_REF:-$remote/main}"

if [ -z "${SKIP_FETCH:-}" ]; then
  git fetch -q --prune "$remote" "+refs/heads/*:refs/remotes/$remote/*"
fi

if [ -n "${PRS_JSON:-}" ]; then
  prs=$(cat "$PRS_JSON")
else
  repo="${GITHUB_REPOSITORY:?set GITHUB_REPOSITORY or PRS_JSON}"
  prs=$(gh pr list --repo "$repo" --state all --limit 1000 --json number,headRefName,headRefOid,state)
fi

board=$( { cat TASKS.md 2>/dev/null; cat tasks.d/*.md 2>/dev/null; } || true)

untracked=()
while IFS= read -r ref; do
  br="${ref#"$remote/"}"
  case "$br" in main|HEAD) continue ;; esac
  head=$(git rev-parse "refs/remotes/$ref")
  # Newest PR first for this branch: number, state, head.
  mine=$(jq -r --arg b "$br" '[.[] | select(.headRefName == $b)] | sort_by(-.number) | .[] | "\(.number) \(.state) \(.headRefOid)"' <<<"$prs")
  grep -q ' OPEN ' <<<"$mine" && continue
  newest=$(head -n1 <<<"$mine")
  if [ -n "$newest" ]; then
    read -r _n st oid <<<"$newest"
    if [ "$st" = MERGED ] && { [ "$head" = "$oid" ] || git merge-base --is-ancestor "$head" "$oid" 2>/dev/null; }; then continue; fi
  fi
  git merge-base --is-ancestor "$head" "$main_ref" && continue
  # Whole-name match: `feat/x` must not count as mentioned because the board says `feat/x-y`
  # or `my-feat/x` (a plain substring test hid untracked branches behind longer names).
  esc=$(printf '%s' "$br" | sed 's/[][\.^$*+?(){}|\/]/\\&/g')
  grep -qE -- "(^|[^A-Za-z0-9._/-])${esc}([^A-Za-z0-9_/-]|\$)" <<<"$board" && continue
  ref_hit=false
  while read -r n _; do
    [ -n "$n" ] || continue
    if grep -qE "(#|/pull/)$n([^0-9]|\$)" <<<"$board"; then ref_hit=true; break; fi
  done <<<"$mine"
  [ "$ref_hit" = true ] && continue
  ahead=$(git rev-list --count "$main_ref..$head")
  last=$(git log -1 --format='%cs %s' "$head" | cut -c1-100)
  prinfo=$(head -n1 <<<"$mine" | awk 'NF { print "PR #" $1 " " tolower($2) }')
  untracked+=("| \`$br\` | $ahead | ${prinfo:-no PR} | $last |")
done < <(git for-each-ref --format='%(refname:lstrip=2)' "refs/remotes/$remote")

report() {
  if [ "${#untracked[@]}" -eq 0 ]; then
    echo "Every remote branch is tracked (open PR, merged, on main, or on the task board)."
    return
  fi
  echo "## Untracked branches (${#untracked[@]})"
  echo
  echo "Each branch below has commits that are not on main, no open pull request and no task-board"
  echo "reference. Open a PR, add a row (tasks.d/ fragment naming the branch), or delete the branch."
  echo
  echo "| Branch | Commits not on main | Last PR | Last commit |"
  echo "|---|---|---|---|"
  printf '%s\n' "${untracked[@]}"
}

report
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && report >>"$GITHUB_STEP_SUMMARY"
[ "${#untracked[@]}" -eq 0 ]
