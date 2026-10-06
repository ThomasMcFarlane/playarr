#!/usr/bin/env bash
# Tests the merge-train re-merge decision, the revert safeguards (#267/#269 regression) and the
# check-fragments trailer exemption in throwaway repos.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
# shellcheck disable=SC1091
GITHUB_REPOSITORY=x/y source "$root/scripts/merge-train.sh"
fail=0
check() { # <name> <expected: yes|no> <main> <head>
  local got=no; remerge_needed "$3" "$4" && got=yes
  if [ "$got" = "$2" ]; then echo "ok   $1"; else echo "FAIL $1 (expected $2, got $got)"; fail=1; fi
}
cd "$tmp"; git init -q -b main .; git config user.name t; git config user.email t@example.invalid
mkdir -p changelog.d tasks.d src; printf 'a\n' >src/a.txt; printf 'b\n' >src/b.txt; printf 'x\n' >CHANGELOG.md; printf 'x\n' >TASKS.md
git add -A; git commit -qm base; base=$(git rev-parse HEAD)

git checkout -qb pr; printf 'a2\n' >src/a.txt; printf 'f\n' >changelog.d/pr.fixed.md; printf 'y\n' >TASKS.md; git add -A; git commit -qm pr
git checkout -q main
printf 'b2\n' >src/b.txt; printf 'z\n' >CHANGELOG.md; printf 'n\n' >tasks.d/1.md; git add -A; git commit -qm independent
check "unrelated main change keeps the tested head" no main pr
git checkout -q -b main2 main; printf 'a3\n' >src/a.txt; git add -A; git commit -qm overlap
check "main touching a PR file forces a re-merge" yes main2 pr
git checkout -q -b main3 "$base"; printf 'zz\n' >CHANGELOG.md; git add -A; git commit -qm shared-only
check "main touching only shared files keeps the head" no main3 pr
git checkout -q -b pr2 "$base"; printf 'c\n' >src/c.txt; git add -A; git commit -qm c
git checkout -q -b main4 "$base"; mkdir -p src/c.txt.d 2>/dev/null || true; rmdir src/c.txt.d; mkdir src/c.txt; printf 'q\n' >src/c.txt/f; git add -A; git commit -qm dirfile
check "tree conflict forces a re-merge" yes main4 pr2

ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }

# --- Revert regression (#267, #269): main gained commits the PR branch does not contain. ---
git checkout -q -b r-main "$base"
printf '| 1 | row one | open | x | |\n' >TASKS.md; git add -A; git commit -qm board
rbase=$(git rev-parse HEAD)
git checkout -q -b r-pr "$rbase"; printf 'a-pr\n' >src/a.txt; git commit -qam pr1; printf 'a-pr2\n' >src/a.txt; git commit -qam pr2
git checkout -q r-main
printf 'policy\n' >SECURITY.md; printf 'b-main\n' >src/b.txt; printf '## New section\n| 2 | row two | open | y | |\n' >>TASKS.md
printf 'x\n- entry from main\n' >CHANGELOG.md; git add -A; git commit -qm "security policy and board"
m1=$(git rev-parse HEAD)
# The old squash: PR tree re-parented onto a main it does not contain.
git checkout -q -b r-buggy r-pr; git reset -q --soft "$m1"; git commit -qm buggy; buggy=$(git rev-parse HEAD)
[ "$(git diff --name-only "$m1" "$buggy" | LC_ALL=C sort | tr '\n' ' ')" = "CHANGELOG.md SECURITY.md TASKS.md src/a.txt src/b.txt " ] \
  && ok "reproduced: the re-parented squash reverts main's files" || bad "revert scenario not reproduced"
if out=$(landing_guard "$m1" "$buggy"); then bad "landing guard let a reverting squash through"; else
  for want in '`SECURITY.md` would be reverted' '`src/b.txt` would be reverted' '`TASKS.md` would lose' '`CHANGELOG.md` would lose'; do
    grep -qF "$want" <<<"$out" && ok "landing guard: $want" || bad "landing guard missed: $want"
  done
fi
# API path: the reverting head lands three-way after main moved again; the guard still sees it.
git checkout -q -b r-main2 "$m1"; printf 'c\n' >src/c.txt; git add -A; git commit -qm independent2; m2=$(git rev-parse HEAD)
landing_guard "$m2" "$buggy" >/dev/null && bad "guard missed the revert on the API merge path" || ok "guard catches the revert on the API merge path"
# train_squash refuses a HEAD that does not contain main.
git checkout -q -B r-try r-pr
train_squash "$m1" -m squash 2>/dev/null && bad "train_squash re-parented a head lacking main" || ok "train_squash refuses a head lacking main"
[ "$(git rev-parse HEAD)" = "$(git rev-parse r-pr)" ] && ok "refused squash left the branch untouched" || bad "refused squash moved HEAD"
# The fixed construction: merge main, then squash. Exactly the PR's diff on top of main.
git merge -q --no-edit "$m1"; train_squash "$m1" -m squash; good=$(git rev-parse HEAD)
[ "$(git diff --name-only "$m1" "$good")" = src/a.txt ] && ok "fixed squash is main plus only the PR's file" || bad "fixed squash changes $(git diff --name-only "$m1" "$good" | tr '\n' ' ')"
landing_guard "$m1" "$good" >/dev/null && ok "guard passes main + PR (fast-forward)" || bad "guard refused a correct squash"
landing_guard "$m2" "$good" >/dev/null && ok "guard passes main + PR (three-way after main moved)" || bad "guard refused a correct three-way landing"
# verify_landed: what GitHub's squash must produce, and the reverting tree it must reject.
git checkout -q --detach "$m2"
gh_ok=$(git commit-tree "$(expected_tree "$m2" "$good")" -p "$m2" -m ok)
gh_bad=$(git commit-tree "$(git rev-parse "$buggy^{tree}")" -p "$m2" -m bad)
verify_landed "$gh_ok" "$good" && ok "verify_landed accepts main + PR" || bad "verify_landed rejected a correct landing"
verify_landed "$gh_bad" "$good" && bad "verify_landed accepted a reverting landing" || ok "verify_landed rejects a reverting landing"
# Legitimate changes still pass: deleting an old file, replacing a TASKS row in place, adding fragments' output.
git checkout -q -b r-legit "$m1"; git rm -q src/b.txt; sed -i 's/| 2 | row two | open |/| 2 | row two | done |/' TASKS.md
printf -- '- fixed entry\n' >>CHANGELOG.md; git commit -qam legit; legit=$(git rev-parse HEAD)
REVERT_WINDOW=0 landing_guard "$m1" "$legit" >/dev/null && ok "guard allows an old-file deletion and an in-place row update" || bad "guard refused a legitimate change"
git checkout -q -b r-recentdel "$m1"; git rm -q SECURITY.md; git commit -qm del
landing_guard "$m1" "$(git rev-parse HEAD)" >/dev/null && bad "guard allowed deleting a just-added file" || ok "guard refuses deleting a file main just added (land manually)"

# A `remove: <row>` fragment deletes a row main just added: allowed only with the train's trailer.
git checkout -q -b r-rm "$m1"; sed -i '/^| 2 | row two/d' TASKS.md; git commit -qam "chore(train): fold fragments for #1"
landing_guard "$m1" "$(git rev-parse HEAD)" >/dev/null && bad "guard allowed an unannounced row removal" || ok "guard refuses removing a recent row without the trailer"
git commit -q --amend -m "chore(train): fold fragments for #1" -m "$REMOVED_TRAILER 2"
landing_guard "$m1" "$(git rev-parse HEAD)" >/dev/null && ok "guard allows a row removed by a remove fragment" || bad "guard refused a remove-fragment row removal"
git reset -q --hard "$m1"

# --- End to end: process() in key mode on a branch that lacks main's newest commit. ---
e2e=$(mktemp -d); git init -q --bare "$e2e/origin.git"
git push -q "$e2e/origin.git" "r-pr:refs/heads/feature" "$m1:refs/heads/main"
git clone -q "$e2e/origin.git" "$e2e/work" 2>/dev/null
mkdir -p "$e2e/work/scripts/ci"; printf '#!/bin/sh\nexit 0\n' >"$e2e/work/scripts/ci/check-hosted-runners.sh"; chmod +x "$e2e/work/scripts/ci/check-hosted-runners.sh"
orig=$(git rev-parse r-pr)
(
  cd "$e2e/work"; git config user.name t; git config user.email t@example.invalid
  gh() { case "$1 $2" in
    "pr view") printf '{"headRefName":"feature","isCrossRepository":false,"isDraft":false,"title":"T","body":"B","baseRefName":"main","state":"OPEN"}\n' ;;
    "pr edit") echo "blocked" >>"$e2e/gh.log" ;;
    *) echo "$*" >>"$e2e/gh.log" ;;
  esac; }
  ci_state() { if [ "$1" = "$orig" ]; then echo none; else echo success; fi; }
  KEY_MODE=true DRY=false SUMMARY=/dev/null process 7 >"$e2e/train.log" 2>&1
)
landed=$(git --git-dir="$e2e/origin.git" rev-parse main)
if [ "$(git --git-dir="$e2e/origin.git" rev-parse "$landed^")" = "$m1" ] \
  && [ "$(git --git-dir="$e2e/origin.git" diff --name-only "$m1" "$landed")" = src/a.txt ]; then
  ok "end to end: the train lands main + the PR's diff, nothing reverted"
else bad "end to end: landed $(git --git-dir="$e2e/origin.git" diff --name-only "$m1" "$landed" | tr '\n' ' ')"; cat "$e2e/train.log"; fi
grep -q 'pr comment\|issues/.*/comments' "$e2e/gh.log" 2>/dev/null && bad "end to end: the train posted a comment" || ok "end to end: the train posted no comment"
rm -rf "$e2e"
git checkout -q main

# block(): label change and summary only, never a comment.
bl=$(mktemp -d)
(
  gh() { echo "$*" >>"$bl/gh.log"; }
  SUMMARY="$bl/summary.md" DRY=false block 9 "reason text" >"$bl/out.log" 2>&1
)
grep -q 'pr edit 9 .*--remove-label ready --add-label blocked' "$bl/gh.log" && ok "block removes ready and adds blocked" || bad "block did not relabel"
grep -qE 'comment' "$bl/gh.log" && bad "block posted a comment" || ok "block posts no comment"
grep -q 'reason text' "$bl/summary.md" && ok "block writes the reason to the job summary" || bad "block left the reason out of the summary"
rm -rf "$bl"
# Static: no comment call of any kind may exist in the train.
grep -nE 'gh pr comment|pr/comments|issues/[^ ]*/comments|-X POST[^|]*comments' "$root/scripts/merge-train.sh" "$root/.github/workflows/merge-train.yml" >/dev/null \
  && bad "a comment call exists in the train" || ok "no comment call exists in the train"

# check-fragments: a commit editing TASKS.md is rejected unless it carries the trailer.
git checkout -q -b origin-main "$base"; git update-ref refs/remotes/origin/main HEAD
git checkout -q -b t1 "$base"; printf 'e\n' >TASKS.md; git add -A; git commit -qm "edit"
git checkout -q -b t2 "$base"; printf 'e\n' >TASKS.md; git add -A; git commit -qm "edit" -m "Merge-Train: yes"
mkdir -p scripts/ci; cp "$root/scripts/ci/check-fragments.sh" scripts/ci/
# Fragment syntax validation is not under test here: stub it out.
printf 'process.exit(0)\n' >scripts/fold-fragments.mjs
# CI checks out a merge commit (PR head is its second parent), so build one.
cf() { git checkout -q -b "m-$1" "$base"; git merge -q --no-ff "$1" -m merge; git update-ref refs/remotes/origin/main "$base"; ( set +e; sed 's#git fetch -q --no-tags origin "\$base"#true#' scripts/ci/check-fragments.sh >scripts/ci/cf.sh; bash scripts/ci/cf.sh >/dev/null 2>&1; echo $? ); rm -f scripts/ci/cf.sh; }
[ "$(cf t1)" = 1 ] && echo "ok   untrailered TASKS.md edit rejected" || { echo "FAIL untrailered edit accepted"; fail=1; }
[ "$(cf t2)" = 0 ] && echo "ok   Merge-Train trailer exempt" || { echo "FAIL trailer not exempt"; fail=1; }

# Co-authored-by: the train strips trailers from the title/body it writes, and CI rejects them in PR commits.
msg=$(printf 'feat: x\n\nCo-authored-by: Claude <noreply@anthropic.com>\nbody line\n  co-AUTHORED-by : Y <y@example.invalid>\nMerge-Train: yes\n' | strip_coauthor)
case "$msg" in *[Cc]o-[Aa]uthored*) echo "FAIL trailer survived strip_coauthor"; fail=1 ;; *) echo "ok   strip_coauthor removes trailers" ;; esac
case "$msg" in *"body line"*"Merge-Train: yes"*) echo "ok   strip_coauthor keeps other lines" ;; *) echo "FAIL strip_coauthor dropped other lines"; fail=1 ;; esac
nc() { git checkout -q -b "n-$1" "$base"; git merge -q --no-ff "$1" -m merge; git update-ref refs/remotes/origin/main "$base"; mkdir -p scripts/ci; ( set +e; sed 's#git fetch -q --no-tags origin "\$base"#true#' "$root/scripts/ci/check-no-coauthor.sh" >scripts/ci/nc.sh; bash scripts/ci/nc.sh >/dev/null 2>&1; echo $? ); rm -f scripts/ci/nc.sh; }
git checkout -q -b c1 "$base"; printf 'k\n' >src/k.txt; git add src; git commit -qm "feat: k" -m "Co-authored-by: Claude <noreply@anthropic.com>"
git checkout -q -b c2 "$base"; printf 'l\n' >src/l.txt; git add src; git commit -qm "feat: l" -m "co-authored-by: lower <l@example.invalid>"
git checkout -q -b c3 "$base"; printf 'm\n' >src/m.txt; git add src; git commit -qm "feat: m mentions Co-authored-by: in prose" -m "Signed-off-by: t <t@example.invalid>"
[ "$(nc c1)" = 1 ] && echo "ok   Co-authored-by commit rejected" || { echo "FAIL Co-authored-by commit accepted"; fail=1; }
[ "$(nc c2)" = 1 ] && echo "ok   lower-case trailer rejected" || { echo "FAIL lower-case trailer accepted"; fail=1; }
[ "$(nc c3)" = 0 ] && echo "ok   clean commit accepted" || { echo "FAIL clean commit rejected"; fail=1; }
exit $fail
