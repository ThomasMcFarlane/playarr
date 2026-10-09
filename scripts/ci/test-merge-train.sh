#!/usr/bin/env bash
# Tests the merge-train fold restore on block and requeue, the re-merge decision, the revert safeguards (#267/#269 regression) and the
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

# --- Fold bookkeeping: a blocked or requeued PR is never left with folded content on its branch. ---
# fold_env <dir>: bare origin + clone with a stub fold script (appends fragments to CHANGELOG.md),
# main at `base`, branch `feature` = base + one src change + one fragment. Sets F_BASE and F_ORIG.
fold_env() {
  local d="$1" w="$1/seed"
  git init -q -b main "$w"; git init -q --bare "$d/origin.git"
  (
    cd "$w"; git config user.name t; git config user.email t@example.invalid
    mkdir -p changelog.d tasks.d scripts/ci src; printf "r\n" >changelog.d/README.md; printf "r\n" >tasks.d/README.md; printf '# Changelog\n' >CHANGELOG.md; printf 'x\n' >TASKS.md; printf 'a\n' >src/a.txt
    printf '#!/bin/sh\nexit 0\n' >scripts/ci/check-hosted-runners.sh; chmod +x scripts/ci/check-hosted-runners.sh
    cat >scripts/fold-fragments.mjs <<'JS'
import fs from 'node:fs';
for (const f of fs.readdirSync('changelog.d')) {
  if (!f.endsWith('.md') || f.toLowerCase() === 'readme.md') continue;
  fs.appendFileSync('CHANGELOG.md', fs.readFileSync(`changelog.d/${f}`, 'utf8'));
  fs.unlinkSync(`changelog.d/${f}`);
}
JS
    git add -A; git commit -qm base; git push -q "$d/origin.git" HEAD:refs/heads/main
    git checkout -qb feature; printf 'a2\n' >src/a.txt; printf -- '- pr entry\n' >changelog.d/pr.fixed.md; git add -A; git commit -qm "pr"
    git push -q "$d/origin.git" feature
  )
  F_BASE=$(git --git-dir="$d/origin.git" rev-parse main); F_ORIG=$(git --git-dir="$d/origin.git" rev-parse feature)
  git clone -q "$d/origin.git" "$d/work" 2>/dev/null
  ( cd "$d/work"; git config user.name t; git config user.email t@example.invalid )
}
# run_train <dir> <key-mode> <ci>: process PR 7 once with a stubbed gh and CI state.
run_train() {
  local d="$1" mode="$2" ci="$3"
  (
    cd "$d/work"
    gh() { case "$1 $2" in
      "pr view") printf '{"headRefName":"feature","isCrossRepository":false,"isDraft":false,"title":"T","body":"B","baseRefName":"main","state":"OPEN"}\n' ;;
      "pr edit") echo "blocked" >>"$d/gh.log" ;;
      *) echo "$*" >>"$d/gh.log" ;;
    esac; }
    ci_state() { if [ "$1" = "$F_ORIG" ]; then echo none; else echo "$ci"; fi; }
    KEY_MODE=$mode DRY=false SUMMARY=/dev/null process 7 >>"$d/train.log" 2>&1 || true
  )
}
ogit() { git --git-dir="$1/origin.git" "${@:2}"; }

for mode in true false; do
  label="key mode"; [ "$mode" = false ] && label="token mode"
  # 1. The train folds and pushes, CI then fails: the branch must go back to the exact original head.
  fe=$(mktemp -d); fold_env "$fe"
  run_train "$fe" "$mode" failure
  [ "$(ogit "$fe" rev-parse feature)" = "$F_ORIG" ] && ok "$label: block after fold restores the original head SHA" || { bad "$label: branch left at $(ogit "$fe" rev-parse feature | cut -c1-8)"; cat "$fe/train.log"; }
  ogit "$fe" show feature:changelog.d/pr.fixed.md >/dev/null 2>&1 && ok "$label: restored branch still holds its fragment" || bad "$label: fragment lost"
  [ "$(ogit "$fe" show feature:CHANGELOG.md)" = "# Changelog" ] && ok "$label: restored branch has no folded CHANGELOG content" || bad "$label: CHANGELOG.md still folded"
  [ -z "$(ogit "$fe" for-each-ref 'refs/train/*')" ] && ok "$label: pre-fold refs removed after the block" || bad "$label: stale pre-fold ref"
  grep -q blocked "$fe/gh.log" && ok "$label: the PR was labelled blocked" || bad "$label: PR not blocked"
  rm -rf "$fe"
done

# 2. Folded and waiting for CI, then main moves with its own CHANGELOG entry: no conflict on requeue.
fe=$(mktemp -d); fold_env "$fe"
run_train "$fe" true pending
folded=$(ogit "$fe" rev-parse feature)
[ "$folded" != "$F_ORIG" ] && [ "$(ogit "$fe" show feature:CHANGELOG.md | grep -c 'pr entry')" = 1 ] && ok "folded head is on the branch while CI runs" || bad "fold was not pushed"
(
  cd "$fe/seed"; git checkout -q main; printf -- '- main entry\n' >>CHANGELOG.md; printf 'b\n' >src/b.txt; git add -A; git commit -qm "main moves"
  git push -q "$fe/origin.git" main
)
moved=$(ogit "$fe" rev-parse main)
run_train "$fe" true success
landed=$(ogit "$fe" rev-parse main)
if [ "$landed" != "$moved" ] && [ "$(ogit "$fe" rev-parse "$landed^")" = "$moved" ]; then
  ok "main moved after the fold: requeue lands on the new main"
else bad "requeue did not land"; cat "$fe/train.log"; fi
ch=$(ogit "$fe" show main:CHANGELOG.md)
{ grep -q 'main entry' <<<"$ch" && grep -q 'pr entry' <<<"$ch" && ! grep -q '^<<<<<<<' <<<"$ch"; } \
  && ok "landed CHANGELOG.md holds both entries, no conflict markers" || bad "landed CHANGELOG.md is wrong: $ch"
[ -z "$(ogit "$fe" for-each-ref 'refs/train/*')" ] && ok "pre-fold refs removed after landing" || bad "stale pre-fold ref after landing"
grep -q 'restoring the pre-fold head' "$fe/train.log" && ok "the train unfolded before re-folding" || bad "no unfold logged"
rm -rf "$fe"


# --- Batch mode: several ready PRs stacked, tested once, landed with one fast-forward. ---
# batch_env <dir>: origin with main (stub fold script) and PR branches feat1 (src/a.txt + fragment), feat2 (src/b.txt +
# fragment), feat3 (src/a.txt again: conflicts with PR 1) and feat4 (src/d.txt, no fragment). Sets B_ORIG1..4.
batch_env() {
  local d="$1" w="$1/seed" n
  git init -q -b main "$w"; git init -q --bare "$d/origin.git"
  (
    cd "$w"; git config user.name t; git config user.email t@example.invalid
    mkdir -p changelog.d tasks.d scripts/ci src; printf "r\n" >changelog.d/README.md; printf "r\n" >tasks.d/README.md; printf '# Changelog\n' >CHANGELOG.md; printf 'x\n' >TASKS.md
    printf 'a\n' >src/a.txt; printf 'b\n' >src/b.txt; printf 'd\n' >src/d.txt
    printf '#!/bin/sh\nexit 0\n' >scripts/ci/check-hosted-runners.sh; chmod +x scripts/ci/check-hosted-runners.sh
    cat >scripts/fold-fragments.mjs <<'JS'
import fs from 'node:fs';
for (const f of fs.readdirSync('changelog.d')) {
  if (!f.endsWith('.md') || f.toLowerCase() === 'readme.md') continue;
  fs.appendFileSync('CHANGELOG.md', fs.readFileSync(`changelog.d/${f}`, 'utf8'));
  fs.unlinkSync(`changelog.d/${f}`);
}
JS
    git add -A; git commit -qm base; git push -q "$d/origin.git" HEAD:refs/heads/main
    for n in 1 2 3 4; do
      git checkout -q -b "feat$n" main
      case "$n" in 1|3) printf "a$n\n" >src/a.txt ;; 2) printf 'b2\n' >src/b.txt ;; 4) printf 'd2\n' >src/d.txt ;; esac
      [ "$n" = 4 ] || printf -- "- pr $n entry\n" >"changelog.d/pr$n.fixed.md"
      git add -A; git commit -qm "pr $n"; git push -q "$d/origin.git" "feat$n"
    done
  )
  git clone -q "$d/origin.git" "$d/work" 2>/dev/null
  ( cd "$d/work"; git config user.name t; git config user.email t@example.invalid )
}
# run_batch <dir> <batch-ci> [ready PRs]: one batch_step with stubbed gh/CI. Each PR head is green on its own; <batch-ci> is the state of the stack.
run_batch() {
  local d="$1" bci="$2" queue="${3:-1 2 3 4}"
  (
    cd "$d/work"
    gh() {
      case "$*" in
        *"workflow run"*) echo "$*" >>"$d/dispatch.log" ;;
        *"pr edit"*) echo "blocked ${3:-}" >>"$d/gh.log" ;;
        *"pr view"*"headRefName,state,labels"*) echo "feat$3" ;;
        *"pr view"*labels*) echo ready ;;
        *"pr view"*) printf '{"headRefName":"feat%s","isCrossRepository":false,"isDraft":false,"title":"T%s","body":"B%s","baseRefName":"main","state":"OPEN"}\n' "$3" "$3" "$3" ;;
        *) echo "$*" >>"$d/gh.log" ;;
      esac
    }
    ready_queue() { tr ' ' '\n' <<<"$queue"; }
    ci_state() { if [ "$1" = "$(git ls-remote origin refs/heads/train/batch 2>/dev/null | awk 'NR==1{print $1}')" ]; then echo "$bci"; else echo success; fi; }
    KEY_MODE=true DRY=false SUMMARY=/dev/null BATCH_MAX=${BATCH_MAX_T:-6}; STOP=false
    batch_step >>"$d/train.log" 2>&1 || true
  )
}
be=$(mktemp -d); batch_env "$be"; m0=$(ogit "$be" rev-parse main)
run_batch "$be" pending
tip=$(ogit "$be" rev-parse train/batch 2>/dev/null || true)
[ -n "$tip" ] && ok "batch: a scratch branch holds the stack" || { bad "batch: no train/batch pushed"; cat "$be/train.log"; }
[ "$(ogit "$be" rev-list --count "$m0..train/batch")" = 3 ] && ok "batch: PRs 1, 2 and 4 stacked, conflicting PR 3 left out" || { bad "batch: wrong stack size"; cat "$be/train.log"; }
grep -q 'blocked 3' "$be/gh.log" && ok "batch: the conflicting PR was blocked alone" || bad "batch: PR 3 not blocked"
grep -q 'workflow run ci.yml.*train/batch' "$be/dispatch.log" && ok "batch: CI dispatched once on the stack" || bad "batch: no CI dispatch"
[ "$(ogit "$be" rev-parse main)" = "$m0" ] && ok "batch: main untouched while the stack is tested" || bad "batch: main moved early"
[ "$(ogit "$be" show train/batch:src/a.txt)" = a1 ] && [ "$(ogit "$be" show train/batch:src/b.txt)" = b2 ] && ok "batch: the stack has every PR's change" || bad "batch: stack content wrong"
ch=$(ogit "$be" show train/batch:CHANGELOG.md)
{ grep -q 'pr 1 entry' <<<"$ch" && grep -q 'pr 2 entry' <<<"$ch"; } && ok "batch: fragments folded into the stack" || bad "batch: fragments not folded"
ogit "$be" show train/batch:changelog.d/pr1.fixed.md >/dev/null 2>&1 && bad "batch: fragment left behind" || ok "batch: folded fragments removed"
[ "$(ogit "$be" log -1 --format=%an train/batch)" = t ] && ok "batch: commits authored by the configured identity" || bad "batch: author"
ogit "$be" log --format=%B "$m0..train/batch" | grep -qi 'co-authored-by' && bad "batch: co-author trailer" || ok "batch: no co-author trailer"
ogit "$be" log --format=%B "$m0..train/batch" | grep -q '^Merge-Train: yes' && ok "batch: Merge-Train trailer on every commit" || bad "batch: trailer missing"
# CI still running: wait.
run_batch "$be" pending; [ "$(ogit "$be" rev-parse train/batch)" = "$tip" ] && [ "$(ogit "$be" rev-parse main)" = "$m0" ] && ok "batch: a running batch is left alone" || bad "batch: disturbed"
# CI green: one fast-forward lands all.
run_batch "$be" success
[ "$(ogit "$be" rev-parse main)" = "$tip" ] && ok "batch: main fast-forwarded to the tested tip" || { bad "batch: main is not the tested tip"; cat "$be/train.log"; }
[ "$(ogit "$be" rev-list --count "$m0..main")" = 3 ] && [ "$(ogit "$be" rev-list --merges --count "$m0..main")" = 0 ] && ok "batch: linear history, one commit per PR" || bad "batch: history shape"
for n in 1 2 4; do
  ogit "$be" rev-parse -q --verify "refs/heads/feat$n" >/dev/null && bad "batch: feat$n branch left" || ok "batch: feat$n branch removed after landing"
done
ogit "$be" rev-parse -q --verify refs/heads/feat3 >/dev/null && ok "batch: the blocked PR's branch is untouched" || bad "batch: feat3 lost"
ogit "$be" rev-parse -q --verify refs/heads/train/batch >/dev/null && bad "batch: scratch branch left" || ok "batch: scratch branch deleted"
[ -z "$(ogit "$be" for-each-ref 'refs/train/*')" ] && ok "batch: no pre-fold refs left" || bad "batch: stale pre-fold ref"
rm -rf "$be"

# The batch's own CI run resumes the train explicitly (workflow_run dropped a completion once), and a
# manual dispatch is a real run by default.
python3 - "$root/.github/workflows/ci.yml" "$root/.github/workflows/merge-train.yml" <<'PY' && ok "ci.yml kicks the train after a train/batch run; dispatch defaults to a real run" || bad "train resume trigger missing"
import sys, yaml
ci = yaml.safe_load(open(sys.argv[1])); mt = yaml.safe_load(open(sys.argv[2]))
k = ci['jobs']['kick-train']
assert k['needs'] == 'ci-required' or k['needs'] == ['ci-required']
assert 'always()' in k['if'] and "train/batch" in k['if'] and 'workflow_dispatch' in k['if']
cmd = ' '.join(s.get('run', '') for s in k['steps'])
assert 'gh workflow run merge-train.yml' in cmd and 'dry_run=false' in cmd
assert k['permissions']['actions'] == 'write'
on = mt.get(True, mt.get('on'))
assert on['workflow_dispatch']['inputs']['dry_run']['default'] is False
assert 'workflow_run' in on and 'schedule' in on
PY

# resolve_shared_conflicts: PNG captures take the PR's version, board files the stack's, anything else fails.
rs=$(mktemp -d)
(
  cd "$rs"; git init -q -b main .; git config user.name t; git config user.email t@example.invalid
  mkdir -p docs/parity/web; printf 'base\000\001' >docs/parity/web/a.png; printf 'x\n' >TASKS.md
  git add -A; git commit -qm base
  git checkout -q -b pr; printf 'pr\000\002' >docs/parity/web/a.png; printf 'pr\n' >TASKS.md; git commit -qam pr
  git checkout -q main; printf 'main\000\003' >docs/parity/web/a.png; printf 'main\n' >TASKS.md; git commit -qam main
  git merge --squash --no-commit pr >/dev/null 2>&1 || true
  resolve_shared_conflicts >/dev/null 2>&1 && echo resolved >"$rs.res"
  printf '%s|%s\n' "$(cat docs/parity/web/a.png | tr '\0\2' '02')" "$(cat TASKS.md)" >"$rs.out"
)
[ "$(cat "$rs.res" 2>/dev/null)" = resolved ] && ok "conflict resolver: PNG and board-file conflicts resolve" || bad "conflict resolver: did not resolve"
[ "$(cat "$rs.out" 2>/dev/null)" = "pr02|main" ] && ok "conflict resolver: PNG takes the PR's capture, TASKS.md the stack's" || bad "conflict resolver: wrong sides ($(cat "$rs.out" 2>/dev/null))"
rm -rf "$rs" "$rs.res" "$rs.out"
rs=$(mktemp -d)
(
  cd "$rs"; git init -q -b main .; git config user.name t; git config user.email t@example.invalid
  mkdir -p docs/parity/web; printf 'x\n' >s.txt; printf 'b\000' >docs/parity/web/a.png; git add -A; git commit -qm base
  git checkout -q -b pr; printf 'pr\n' >s.txt; printf 'p\000' >docs/parity/web/a.png; git commit -qam pr
  git checkout -q main; printf 'm\n' >s.txt; printf 'm\000' >docs/parity/web/a.png; git commit -qam main
  git merge --squash --no-commit pr >/dev/null 2>&1 || true
  resolve_shared_conflicts >/dev/null 2>&1 || echo refused >"$rs.res"
)
[ "$(cat "$rs.res" 2>/dev/null)" = refused ] && ok "conflict resolver: a source-file conflict is still refused" || bad "conflict resolver: resolved a source conflict"
rm -rf "$rs" "$rs.res"

# A PR whose regenerated parity capture conflicts with main's is stacked with its own capture, not blocked.
be=$(mktemp -d); batch_env "$be"
(
  cd "$be/seed"; git checkout -q main; mkdir -p docs/parity/web; printf 'v0\000' >docs/parity/web/p.png; git add -A; git commit -qm "capture v0"
  git checkout -q -b feat5; printf 'v1\000' >docs/parity/web/p.png; printf 'five\n' >src/five.txt; git add -A; git commit -qm "pr 5"
  git checkout -q main; printf 'v2\000' >docs/parity/web/p.png; git commit -qam "capture v2"
  git push -q "$be/origin.git" main feat5
)
m0=$(ogit "$be" rev-parse main)
run_batch "$be" pending "5"
if [ "$(ogit "$be" rev-list --count "$m0..train/batch" 2>/dev/null)" = 1 ] && [ "$(ogit "$be" show train/batch:docs/parity/web/p.png | tr '\0' 0)" = v10 ]; then ok "batch: a conflicting parity PNG is stacked with the PR's capture"; else bad "batch: PNG conflict not auto-resolved"; cat "$be/train.log"; fi
grep -q 'blocked 5' "$be/gh.log" 2>/dev/null && bad "batch: PNG-conflict PR was blocked" || ok "batch: PNG-conflict PR not blocked"
rm -rf "$be"

# prioritise_batch: cancels queued PR runs of PRs that are not ready, only while the batch CI is queued.
pb=$(mktemp -d)
(
  REPO=o/r; DRY=false; BATCH_BR=train/batch; log() { echo "$*" >>"$pb/log"; }
  gh() {
    case "$*" in
      *"--branch train/batch"*) echo "${PB_WAIT:-1}" ;;
      *"pr list"*) echo ready-branch ;;
      *"run list"*) printf '%s\n' "11 ready-branch" "12 other-branch" "13 third-branch" ;;
      *"run cancel"*) echo "$3" >>"$pb/cancelled" ;;
    esac
  }
  prioritise_batch
  PB_WAIT=0 prioritise_batch
) >/dev/null 2>&1
{ [ "$(sort "$pb/cancelled" 2>/dev/null | tr '\n' ' ')" = "12 13 " ]; } && ok "prioritise: queued runs of non-ready PRs are cancelled, ready PRs' are kept, only while the batch waits" || bad "prioritise: wrong cancellations ($(cat "$pb/cancelled" 2>/dev/null | tr '\n' ' '))"
rm -rf "$pb"

# Red batch: halved down to the culprit, which alone is blocked.
be=$(mktemp -d); batch_env "$be"; m0=$(ogit "$be" rev-parse main)
run_batch "$be" pending "1 2 4"
[ "$(ogit "$be" rev-list --count "$m0..train/batch")" = 3 ] && ok "batch red: stack of three built" || bad "batch red: stack"
run_batch "$be" failure "1 2 4"
[ "$(ogit "$be" rev-list --count "$m0..train/batch")" = 2 ] && ok "batch red: retried with the first half (2 of 3)" || { bad "batch red: not halved"; cat "$be/train.log"; }
run_batch "$be" failure "1 2 4"
[ "$(ogit "$be" rev-list --count "$m0..train/batch")" = 1 ] && ok "batch red: halved again (1 of 2)" || bad "batch red: not halved again"
run_batch "$be" failure "1 2 4"
grep -q 'blocked 1' "$be/gh.log" && ok "batch red: the single culprit is blocked" || bad "batch red: culprit not blocked"
[ "$(ogit "$be" rev-parse main)" = "$m0" ] && ok "batch red: main never moved" || bad "batch red: main moved"
rm -rf "$be"

# Flaky class: a lone tiny parity-pin failure is re-run once instead of halving; anything else halves.
# flaky_case <log text> <failed job> <run_attempt>: prints "rerun" or "none".
flaky_case() {
  local out; out=$(
    REPO=o/r; log() { :; }; DRY=false
    gh() {
      case "$*" in
        "api repos/o/r/actions/runs?head_sha=abc"*) echo "77 $FL_ATTEMPT" ;;
        "api repos/o/r/actions/runs/77/jobs"*) printf '%s\n' "$FL_JOBS" ;;
        "run view 77"*) printf '%s\n' "$FL_LOG" ;;
        "run rerun 77"*) echo rerun ;;
      esac
    }
    flaky_rerun abc >/dev/null 2>&1 && echo rerun || echo none
    ) ; echo "$out"
}
FL_ATTEMPT=1 FL_JOBS="web layout parity (layout)" FL_LOG="FAIL  tv/light focus pin: 13 mismatched pixels against docs/parity/x.png"
[ "$(flaky_case)" = rerun ] && ok "flaky: a 13 px parity pin failure is re-run" || bad "flaky: tiny pin not re-run"
FL_LOG="FAIL  tv/light focus pin: 5000 mismatched pixels against docs/parity/x.png"
[ "$(flaky_case)" = none ] && ok "flaky: a large pixel diff halves" || bad "flaky: large diff re-run"
FL_LOG=$'FAIL  a: 3 mismatched pixels against x.png\nFAIL  b: header band 0 not found'
[ "$(flaky_case)" = none ] && ok "flaky: a mixed failure halves" || bad "flaky: mixed failure re-run"
FL_LOG="FAIL  a: 3 mismatched pixels against x.png" FL_JOBS=$'web layout parity (layout)\nTV web lint'
[ "$(flaky_case)" = none ] && ok "flaky: another failed job halves" || bad "flaky: other job re-run"
FL_JOBS="web layout parity (nav)" FL_ATTEMPT=2
[ "$(flaky_case)" = none ] && ok "flaky: a second attempt halves" || bad "flaky: re-run twice"

# A PR head that moves while the stack is tested discards the stack instead of landing it.
be=$(mktemp -d); batch_env "$be"; m0=$(ogit "$be" rev-parse main)
run_batch "$be" pending "1 2"
( cd "$be/seed"; git checkout -q feat2; printf 'b3\n' >src/b.txt; git commit -qam "fix up"; git push -q "$be/origin.git" feat2 )
run_batch "$be" success "1 2"
if [ "$(ogit "$be" rev-parse main)" = "$m0" ] && grep -q 'changed since the batch was built' "$be/train.log"; then ok "batch: a moved PR head discards the tested stack"; else bad "batch: landed a stale stack"; cat "$be/train.log"; fi
rm -rf "$be"
# Main moving independently discards the stack too.
be=$(mktemp -d); batch_env "$be"
run_batch "$be" pending "1 2"
( cd "$be/seed"; git checkout -q main; printf 'z\n' >src/z.txt; git add -A; git commit -qm "hotfix"; git push -q "$be/origin.git" main )
moved=$(ogit "$be" rev-parse main)
run_batch "$be" success "1 2"
if [ "$(ogit "$be" rev-parse main)" = "$moved" ] && grep -q 'main moved since the batch was built' "$be/train.log"; then ok "batch: a moved main discards the tested stack"; else bad "batch: landed on a moved main"; cat "$be/train.log"; fi
rm -rf "$be"

# block(): label change, job summary and one full-reason PR comment.
bl=$(mktemp -d)
(
  gh() { echo "$*" >>"$bl/gh.log"; }
  SUMMARY="$bl/summary.md" DRY=false block 9 "reason text" >"$bl/out.log" 2>&1
)
grep -q 'pr edit 9 .*--remove-label ready --add-label blocked' "$bl/gh.log" && ok "block removes ready and adds blocked" || bad "block did not relabel"
[ "$(grep -c '^pr comment 9 ' "$bl/gh.log")" = 1 ] && grep -q 'reason text' "$bl/gh.log" && ok "block posts one comment with the full reason" || bad "block comment missing or wrong"
grep -q 'reason text' "$bl/summary.md" && ok "block writes the reason to the job summary" || bad "block left the reason out of the summary"
rm -rf "$bl"
# Static: the only comment call in the train is the block reason.
[ "$(grep -cE 'gh pr comment|pr/comments|issues/[^ ]*/comments|-X POST[^|]*comments' "$root/scripts/merge-train.sh" "$root/scripts/merge-train-batch.sh" | awk -F: '{n+=$2} END{print n}')" = 1 ] \
  && ok "block is the only comment call in the train" || bad "unexpected comment calls in the train"

# check-fragments: a commit editing TASKS.md is rejected unless it carries the trailer.
git checkout -q -b origin-main "$base"; git update-ref refs/remotes/origin/main HEAD
git checkout -q -b t1 "$base"; printf 'e\n' >TASKS.md; git add -A; git commit -qm "edit"
git checkout -q -b t2 "$base"; printf 'e\n' >TASKS.md; git add -A; git commit -qm "edit" -m "Merge-Train: yes"
git checkout -q -b t3 "$base"; printf 'e\n' >TASKS.md; git add -A; git commit -qm "chore(board-format): canonical board"
mkdir -p scripts/ci; cp "$root/scripts/ci/check-fragments.sh" scripts/ci/
# Fragment syntax validation is not under test here: stub it out.
printf 'process.exit(0)\n' >scripts/fold-fragments.mjs
# CI checks out a merge commit (PR head is its second parent), so build one.
cf() { git checkout -q -b "m-$1" "$base"; git merge -q --no-ff "$1" -m merge; git update-ref refs/remotes/origin/main "$base"; ( set +e; sed 's#git fetch -q --no-tags origin "\$base"#true#' scripts/ci/check-fragments.sh >scripts/ci/cf.sh; bash scripts/ci/cf.sh >/dev/null 2>&1; echo $? ); rm -f scripts/ci/cf.sh; }
[ "$(cf t1)" = 1 ] && echo "ok   untrailered TASKS.md edit rejected" || { echo "FAIL untrailered edit accepted"; fail=1; }
[ "$(cf t2)" = 0 ] && echo "ok   Merge-Train trailer exempt" || { echo "FAIL trailer not exempt"; fail=1; }
[ "$(cf t3)" = 0 ] && echo "ok   board-format migration commit exempt" || { echo "FAIL board-format commit not exempt"; fail=1; }

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
