#!/usr/bin/env bash
# Merge train, batch mode (key mode only). Sourced by scripts/merge-train.sh.
#
# The one-PR-at-a-time train waited for CI on every PR after folding its fragments (about 10 to 15 minutes
# each), so a dozen ready PRs queued for hours. Batch mode tests several ready PRs together, merge-queue style:
#
#   1. Candidates are the `ready` PRs (oldest first) whose OWN head already has a green `ci-required`. A PR whose
#      CI is still running is skipped this round, not waited for, so it never holds the queue.
#   2. They are stacked on a scratch branch `train/batch` as one squash commit per PR on top of current main
#      (the commit the single-PR train would build: title (#n), body, fragments folded, trailers
#      `Merge-Train: yes`, `Train-PR`, `Train-Head`). Every PR passes the same landing guard as before, measured
#      against the stack it lands on (changes no file outside its own diff, restores nothing main's recent
#      commits replaced, drops no TASKS/CHANGELOG line). A PR that conflicts or fails the guard is blocked alone.
#      A conflict confined to CHANGELOG.md / TASKS.md (stale fold content) is resolved to the stack's version.
#   3. CI runs once on the batch tip (workflow_dispatch on `train/batch`; an affected-only run against main).
#   4. Green: each PR branch is moved to its own commit of the stack and main is fast-forwarded to the tip, so
#      every PR shows as merged and main's tree is exactly the tested tree. A moved head, a moved main or a
#      withdrawn `ready` label discards the batch instead (nothing lands that was not tested).
#   5. Red: the batch is halved (first half rebuilt and retested), down to one PR, which is blocked. The rest
#      stay `ready` and join the next batch.
#
# State lives in the `train/batch` branch only: its commits carry Train-PR and Train-Head trailers.
BATCH_BR="train/batch"
BATCH_MAX="${BATCH_MAX:-6}"

# batch_members <main> <tip>: "<pr> <head> <commit>" per stacked PR, oldest first.
batch_members() {
  local c msg pr head
  for c in $(git rev-list --reverse "$1..$2"); do
    msg=$(git log -1 --format=%B "$c")
    pr=$(sed -n 's/^Train-PR:[[:space:]]*//p' <<<"$msg" | head -n1)
    head=$(sed -n 's/^Train-Head:[[:space:]]*//p' <<<"$msg" | head -n1)
    [ -n "$pr" ] && [ -n "$head" ] && echo "$pr $head $c"
  done
}

# prioritise_batch: GitHub's runner pool (about 20 Linux jobs for a public repository) is shared by every open PR, so
# a batch's CI can queue behind them for 30 minutes. While the batch CI is still waiting for a runner, cancel the
# QUEUED (not running) pull_request CI runs of PRs that are not `ready`; they re-run when the PR is labelled `ready`
# (the labeled trigger) or pushed again. Ready PRs' runs are kept: they are what qualifies a PR for a batch.
prioritise_batch() {
  [ "$DRY" = true ] && return 0
  local waiting ready_branches id br n=0
  waiting=$(gh run list --repo "$REPO" --workflow ci.yml --branch "$BATCH_BR" --status queued --json databaseId --jq 'length' 2>/dev/null || echo 0)
  [ "${waiting:-0}" -gt 0 ] || return 0
  ready_branches=$(gh pr list --repo "$REPO" --label ready --state open --json headRefName --jq '.[].headRefName' 2>/dev/null)
  while read -r id br; do
    [ -n "$id" ] || continue
    grep -qxF "$br" <<<"$ready_branches" && continue
    gh run cancel "$id" --repo "$REPO" >/dev/null 2>&1 && n=$((n + 1))
  done < <(gh run list --repo "$REPO" --workflow ci.yml --status queued --limit 100 --json databaseId,headBranch,event \
    --jq '.[]|select(.event=="pull_request")|"\(.databaseId) \(.headBranch)"' 2>/dev/null)
  [ "$n" -eq 0 ] || log "batch CI is waiting for a runner: cancelled $n queued CI run(s) of PRs that are not ready"
}

# flaky_rerun <tip>: when CI on <tip> failed only in the known flaky class, re-run the failed jobs once instead of
# halving the batch (each halving round costs a full CI run). The class: every failed job is `web layout parity`,
# and every failure line in its log is a pixel pin with at most FLAKY_MAX_PIXELS mismatched pixels. A second
# attempt (run_attempt > 1) is never re-run, so a real failure still halves. Succeeds when it re-ran something.
FLAKY_MAX_PIXELS="${FLAKY_MAX_PIXELS:-100}"
flaky_rerun() {
  local tip="$1" run id attempt jobs bad log fails tiny
  run=$(gh api "repos/$REPO/actions/runs?head_sha=$tip&per_page=50" \
    --jq '[.workflow_runs[]|select(.path==".github/workflows/ci.yml" and .event=="workflow_dispatch" and .status=="completed")]|sort_by(.created_at)|last|select(.!=null)|"\(.id) \(.run_attempt)"' 2>/dev/null) || return 1
  [ -n "$run" ] || return 1
  id=${run% *}; attempt=${run#* }
  [ "$attempt" = 1 ] || return 1
  jobs=$(gh api "repos/$REPO/actions/runs/$id/jobs?per_page=100" --jq '.jobs[]|select(.conclusion=="failure" and .name!="ci-required")|.name' 2>/dev/null) || return 1
  [ -n "$jobs" ] || return 1
  bad=$(grep -Ev '^web layout parity' <<<"$jobs" || true)
  [ -z "$bad" ] || return 1
  log=$(gh run view "$id" --repo "$REPO" --log-failed 2>/dev/null) || return 1
  fails=$(grep -cE '(^|[[:space:]])FAIL[[:space:]]' <<<"$log" || true)
  tiny=$(sed -nE 's/.*FAIL[[:space:]].*: ([0-9]+) mismatched pixels against.*/\1/p' <<<"$log" | awk -v m="$FLAKY_MAX_PIXELS" '$1>0 && $1<=m' | wc -l)
  [ "$fails" -gt 0 ] && [ "$fails" = "$tiny" ] || return 1
  log "batch CI failed only on $tiny tiny parity pin(s) (<= $FLAKY_MAX_PIXELS px): re-running the failed jobs once instead of halving"
  gh run rerun "$id" --repo "$REPO" --failed >/dev/null 2>&1
}

# batch_drop: delete the remote scratch branch.
batch_drop() { [ "$DRY" = true ] || git push -q origin --delete "$BATCH_BR" >/dev/null 2>&1 || true; }

# resolve_shared_conflicts: after a conflicted `git merge --squash`, succeeds when every conflicted path is
#   - CHANGELOG.md or TASKS.md (PRs add fragments and never edit them; a conflict there is stale fold
#     content): takes the stack's version; or
#   - a regenerated parity capture (docs/parity/**/*.png, binary, so never mergeable): takes the PR's
#     capture. The stack's own CI then judges it (layout parity compares at 0 pixels), and a wrong
#     capture turns the stack red, so the halving blocks that PR alone.
# Fails, leaving the index alone, when anything else conflicts.
resolve_shared_conflicts() {
  PNG_RESOLVED=false
  local u; u=$(git diff --name-only --diff-filter=U)
  [ -n "$u" ] || return 1
  grep -qvxE 'CHANGELOG\.md|TASKS\.md|docs/parity/.*\.png' <<<"$u" && return 1
  local f
  while IFS= read -r f; do
    case "$f" in
      *.png) git checkout -q --theirs -- "$f" && git add -- "$f" || return 1; PNG_RESOLVED=true; log "regenerated capture $f conflicted: taking the PR's version for the stack's CI to judge" >&2 ;;
      *) git checkout -q --ours -- "$f" && git add -- "$f" || return 1 ;;
    esac
  done <<<"$u"
}

# batch_stack <pr> <tip>: stack one PR's squash commit on top of <tip>. Prints the new commit on success;
# otherwise prints nothing, leaves the work tree at <tip> and (for a real fault) blocks the PR.
batch_stack() {
  local pr="$1" tip="$2" info br title body head cross draft base st
  info=$(gh pr view "$pr" --repo "$REPO" --json headRefName,isCrossRepository,isDraft,title,body,baseRefName,state) || {
    log "PR #$pr: cannot read, skipping" >&2; return 1; }
  [ "$(jq -r .state <<<"$info")" = OPEN ] || { log "PR #$pr not open, skipping" >&2; return 1; }
  br=$(jq -r .headRefName <<<"$info"); title=$(jq -r .title <<<"$info" | strip_coauthor); body=$(jq -r .body <<<"$info" | strip_coauthor)
  base=$(jq -r .baseRefName <<<"$info"); cross=$(jq -r .isCrossRepository <<<"$info"); draft=$(jq -r .isDraft <<<"$info")
  [ "$cross" = true ] && { block "$pr" "Pull requests from forks cannot be trained." >&2; return 1; }
  [ "$draft" = true ] && { block "$pr" "The pull request is a draft." >&2; return 1; }
  [ "$base" = main ] || { block "$pr" "Base branch is \`$base\`, not \`main\`." >&2; return 1; }
  git fetch -q origin "+refs/heads/$br:refs/remotes/origin/$br" || { log "PR #$pr: could not fetch \`$br\`, skipping" >&2; return 1; }
  head=$(git rev-parse "origin/$br")
  if [ "$DRY" != true ] && [ -n "$(folded_original "$pr" "$head")" ]; then
    # A branch still holding a single-PR fold: restore the original head; it joins a later batch.
    unfold_branch "$pr" "$br" >&2 || log "PR #$pr: could not restore \`$br\` to its pre-fold head" >&2
    return 1
  fi
  st=$(ci_state "$head")
  case "$st" in
    success) ;;
    failure) block "$pr" "\`ci-required\` failed on \`$head\`. See the checks on the pull request." >&2; return 1 ;;
    none)
      if [ $(( $(date +%s) - $(git log -1 --format=%ct "$head") )) -lt 600 ]; then
        log "PR #$pr: no CI run registered yet for $head (pushed moments ago); it joins a later batch" >&2
      else
        log "PR #$pr: no CI run for $head, dispatching; it joins a later batch" >&2; run gh workflow run ci.yml --repo "$REPO" --ref "$br" >&2
      fi
      return 1 ;;
    *) log "PR #$pr: ci-required still running on its own head; it joins a later batch" >&2; return 1 ;;
  esac

  git checkout -q -f -B batch-work "$tip" && git clean -fdq
  PNG_RESOLVED=false
  if ! git merge --squash --no-commit "origin/$br" >/tmp/train-merge.log 2>&1; then
    if ! resolve_shared_conflicts; then
      local files; files=$(git diff --name-only --diff-filter=U | head -20 | sed 's/^/- `/;s/$/`/')
      git reset -q --hard "$tip"
      block "$pr" "Merging \`$br\` onto the latest \`main\` (and the PRs ahead of it in the batch) conflicts in:

$files" >&2
      return 1
    fi
  fi
  local removed_rows=""
  if [ -n "$(find changelog.d tasks.d -name '*.md' ! -iname README.md 2>/dev/null)" ]; then
    if ! node scripts/fold-fragments.mjs >/tmp/train-fold.log 2>&1; then
      git reset -q --hard "$tip"
      block "$pr" "Invalid changelog or task fragments:

\`\`\`
$(head -c 1500 /tmp/train-fold.log)
\`\`\`" >&2
      return 1
    fi
    git add -A CHANGELOG.md TASKS.md changelog.d tasks.d
    removed_rows=$(removed_rows_in_diff)
  fi
  if git grep -qE '^(<<<<<<< |>>>>>>> )' -- ':!*.lock' ':!*.snap'; then
    local marks; marks=$(git grep -lE '^(<<<<<<< |>>>>>>> )' -- ':!*.lock' ':!*.snap' | head -10 | sed 's/^/- `/;s/$/`/')
    git reset -q --hard "$tip"
    block "$pr" "Conflict markers are present after merging \`main\`:

$marks" >&2
    return 1
  fi
  local hosted_out
  if ! hosted_out=$(scripts/ci/check-hosted-runners.sh 2>&1); then
    git reset -q --hard "$tip"
    block "$pr" "The resulting tree targets a runner that is not GitHub-hosted, which this public repository forbids (use \`runs-on: ubuntu-latest\`, \`windows-latest\` or \`macos-latest\`):

\`\`\`
$(printf '%s' "$hosted_out" | head -c 1500)
\`\`\`" >&2
    return 1
  fi
  git add -A
  if git diff --cached --quiet; then
    git reset -q --hard "$tip"; block "$pr" "Nothing to commit: the change is empty or already on main." >&2; return 1
  fi
  git commit -q -m "$title (#$pr)" -m "$body" -m "$TRAIN_TRAILER" -m "Train-PR: $pr" -m "Train-Head: $head" \
    ${removed_rows:+-m "$REMOVED_TRAILER $removed_rows"} || { git reset -q --hard "$tip"; block "$pr" "Committing the squash failed." >&2; return 1; }
  local sq guard fold_extra; sq=$(git rev-parse HEAD)
  # Landing guard, as for a single PR, against the stack this PR lands on: the PR head itself (own diff,
  # reverts), then the fold (TASKS/CHANGELOG lines), and the squash may differ from the plain merge only in
  # the shared board files.
  if [ "$PNG_RESOLVED" = true ]; then
    # The plain merge of the head conflicts (binary captures), so the guards below cannot compute it.
    # Equivalent check: the stack commit changes only files the PR's own diff touches, plus board files.
    local own extra
    own=$(git diff --name-only --no-renames "$(git merge-base "$tip" "$head")" "$head" | sort -u)
    extra=$(comm -23 <(git diff --name-only --no-renames "$tip" "$sq" | sort -u) <(printf '%s\n' "$own") | grep -Ev "$SHARED_RE" || true)
    if [ -n "$extra" ]; then
      git reset -q --hard "$tip"
      block "$pr" "Landing guard: after resolving regenerated parity captures, landing \`$head\` on \`main\` (\`$tip\`) would change more than this PR's own diff:

$(sed 's/^/- changes `/;s/$/`, which the PR does not touch/' <<<"$extra")" >&2
      return 1
    fi
    echo "$sq"; return 0
  fi
  if ! guard=$(landing_guard "$tip" "$head"); then
    git reset -q --hard "$tip"
    block "$pr" "Landing guard: landing \`$head\` on \`main\` (\`$tip\`) would change more than this PR's own diff:

$guard
If this is intended (for example a deliberate revert), land it manually under merge rule v2." >&2
    return 1
  fi
  if ! guard=$(landing_guard "$tip" "$sq"); then
    git reset -q --hard "$tip"
    block "$pr" "Landing guard on the folded result: it would change more than this PR's own diff:

$guard" >&2
    return 1
  fi
  fold_extra=$(git diff --name-only --no-renames "$(expected_tree "$tip" "$head")" "$sq^{tree}" | grep -Ev "$SHARED_RE" || true)
  if [ -n "$fold_extra" ]; then
    git reset -q --hard "$tip"
    block "$pr" "Landing guard: the folded result differs from the plain merge outside the board files:

$(sed 's/^/- `/;s/$/`/' <<<"$fold_extra")" >&2
    return 1
  fi
  echo "$sq"
}

# batch_build <limit>: build a fresh stack on origin/main from the ready queue and start CI on it.
batch_build() {
  local limit="$1" main tip pr n=0 sq
  git fetch -q origin main; main=$(git rev-parse origin/main); tip="$main"
  for pr in $(ready_queue); do
    [ "$n" -ge "$limit" ] && break
    if [ "$DRY" != true ]; then
      gh pr view "$pr" --repo "$REPO" --json labels --jq '.labels[].name' | grep -qx ready || { log "PR #$pr no longer ready"; continue; }
    fi
    if sq=$(batch_stack "$pr" "$tip") && [ -n "$sq" ]; then
      tip="$sq"; n=$((n + 1))
      log "PR #$pr: stacked as $(git rev-parse --short "$sq") ($n of at most $limit)"
    fi
  done
  git checkout -q -f -B batch-work "$tip"
  if [ "$n" -eq 0 ]; then log "no PR is ready to batch (waiting on their own CI, or blocked)"; return 0; fi
  if [ "$DRY" = true ]; then log "dry run: batch of $n built locally on $tip, nothing pushed"; return 0; fi
  git push -q origin "+$tip:refs/heads/$BATCH_BR" || { log "could not push $BATCH_BR"; STOP=true; return 0; }
  log "batch of $n pushed as $tip; starting CI on $BATCH_BR"
  gh workflow run ci.yml --repo "$REPO" --ref "$BATCH_BR" >/dev/null 2>&1 || log "could not dispatch CI on $BATCH_BR"
  STOP=true
}

# batch_land <main> <tip>: move every PR branch to its stack commit, then fast-forward main to the tip.
batch_land() {
  local main="$1" tip="$2" pr head sq cur members ok=true
  local -A branch=() pushed=()
  members=$(batch_members "$main" "$tip")
  # The heads and labels must be exactly what was tested.
  while read -r pr head sq; do
    [ -n "$pr" ] || continue
    branch[$pr]=$(gh pr view "$pr" --repo "$REPO" --json headRefName,state,labels \
      --jq 'select(.state=="OPEN" and ([.labels[].name]|index("ready"))!=null)|.headRefName' 2>/dev/null)
    cur=""; [ -n "${branch[$pr]}" ] && cur=$(git ls-remote origin "refs/heads/${branch[$pr]}" | awk 'NR==1{print $1}')
    if [ -z "$cur" ] || [ "$cur" != "$head" ]; then
      log "PR #$pr changed since the batch was built (head, label or state); discarding the batch"; batch_drop; return 0
    fi
  done <<<"$members"
  while read -r pr head sq; do
    [ -n "$pr" ] || continue
    git push -q origin "$head:$PF_NS/$pr/$sq" 2>/dev/null || true
    if git push -q origin "$sq:refs/heads/${branch[$pr]}" --force-with-lease="refs/heads/${branch[$pr]}:$head" 2>/tmp/train-push.log; then
      pushed[$pr]=1
    else
      ok=false; log "PR #$pr: could not move ${branch[$pr]} to its stack commit ($(head -c 200 /tmp/train-push.log))"; break
    fi
  done <<<"$members"
  if [ "$ok" = true ] && ! git push -q origin "$tip:refs/heads/main" 2>/tmp/train-push.log; then
    ok=false; log "main moved during landing ($(head -c 200 /tmp/train-push.log))"
  fi
  if [ "$ok" != true ]; then
    for pr in "${!pushed[@]}"; do unfold_branch "$pr" "${branch[$pr]}" || log "PR #$pr: could not restore ${branch[$pr]}"; done
    batch_drop; return 0
  fi
  while read -r pr head sq; do
    [ -n "$pr" ] || continue
    git push -q origin --delete "${branch[$pr]}" 2>/dev/null || true
    drop_pf_refs "$pr"
    log "PR #$pr: landed as $sq"
  done <<<"$members"
  batch_drop
  log "batch landed: main is now $tip"
}

# batch_step: advance the batch state machine by one step. Returns 1 when batch mode does not apply (token
# mode), so the caller falls back to the single-PR path.
batch_step() {
  [ "$KEY_MODE" = true ] && [ "$BATCH_MAX" -gt 1 ] || return 1
  TRAIN_BR=""
  if [ "$DRY" = true ]; then batch_build "$BATCH_MAX"; return 0; fi
  local main tip st members n
  git fetch -q origin main; main=$(git rev-parse origin/main)
  if git ls-remote --exit-code origin "refs/heads/$BATCH_BR" >/dev/null 2>&1; then
    git fetch -q origin "+refs/heads/$BATCH_BR:refs/remotes/origin/$BATCH_BR" || { log "could not fetch $BATCH_BR"; STOP=true; return 0; }
    tip=$(git rev-parse "origin/$BATCH_BR")
    if ! git merge-base --is-ancestor "$main" "$tip"; then
      log "main moved since the batch was built; discarding it"; batch_drop
    else
      members=$(batch_members "$main" "$tip"); n=$(grep -c . <<<"$members")
      st=$(ci_state "$tip")
      case "$st" in
        pending) log "batch of $n: ci-required running on $tip; the next trigger resumes"; prioritise_batch; STOP=true; return 0 ;;
        none)
          if [ $(( $(date +%s) - $(git log -1 --format=%ct "$tip") )) -lt 600 ]; then log "batch of $n: no CI run registered yet for $tip, waiting"
          else log "batch of $n: no CI run for $tip, dispatching"; gh workflow run ci.yml --repo "$REPO" --ref "$BATCH_BR" >/dev/null 2>&1; fi
          STOP=true; return 0 ;;
        success)
          batch_land "$main" "$tip"
          # Start the next batch straight away instead of waiting for the next trigger.
          if ! git ls-remote --exit-code origin "refs/heads/$BATCH_BR" >/dev/null 2>&1; then batch_build "$BATCH_MAX"; fi
          return 0 ;;
        failure)
          if [ "$DRY" != true ] && flaky_rerun "$tip"; then STOP=true; return 0; fi
          if [ "$n" -le 1 ]; then
            local pr; pr=$(awk 'NR==1{print $1}' <<<"$members")
            batch_drop
            [ -n "$pr" ] && block "$pr" "\`ci-required\` failed on \`$tip\` with this PR stacked alone on the latest \`main\`. See the CI run on branch $BATCH_BR."
          else
            local half=$(( (n + 1) / 2 ))
            log "batch of $n failed on $tip: retrying with the first $half PR(s) to find the culprit"
            batch_drop; batch_build "$half"; return 0
          fi ;;
      esac
    fi
  fi
  batch_build "$BATCH_MAX"
  return 0
}
