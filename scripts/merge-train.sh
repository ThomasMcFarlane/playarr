#!/usr/bin/env bash
# Merge train: lands pull requests labelled `ready` one at a time, oldest first.
#
# Equivalent of GitHub's native merge queue (unavailable for repositories on a
# personal account). For each ready PR it:
#   1. keeps the tested head untouched when it needs no change: main is merged in
#      only when main's new commits touch the PR's files (CHANGELOG.md, TASKS.md,
#      changelog.d/ and tasks.d/ excluded) or `git merge-tree` reports a conflict,
#      so queued or running CI is never cancelled by an unrelated change on main.
#      Whenever the train has to rewrite the head anyway (fragments to fold, or a
#      multi-commit branch to squash) it merges the current main in first: every
#      head the train builds is current main plus the PR's diff, never a PR tree
#      re-parented onto a main it does not contain (that reverted main's newer
#      commits in #267 and #269),
#   2. pushes (only if the head had to change) and waits for `ci-required` on that
#      exact head SHA,
#   3. lands it when main has not moved in a way that could invalidate the result
#      (otherwise repeats from 1); if main moved independently the tested head is
#      squash-merged through the API with --match-head-commit, which merges it
#      three-way onto the current main. Before landing, landing_guard checks that
#      the result changes only the PR's files and restores no version of a file
#      (or no TASKS/CHANGELOG line) that main's recent commits replaced; after an
#      API merge verify_landed checks that main's new tree is exactly
#      main + the PR. Either failing stops the train,
#   4. on any failure removes `ready`, adds `blocked`, comments the reason and
#      moves on to the next PR.
#
# Environment:
#   GH_TOKEN             token for gh (github.token is enough)
#   GITHUB_REPOSITORY    owner/name
#   DRY_RUN=true         do everything locally and read-only; no push, label,
#                        comment or merge
#   ONLY_PR=<n>          process just this PR (still must carry `ready`, unless
#                        DRY_RUN=true)
#   TRAIN_KEY_MODE=true  git `origin` authenticates with a deploy key, so pushes
#                        trigger workflows. The branch is squashed to one commit
#                        and main is fast-forwarded to it (or, when main moved
#                        independently, the tested head is squash-merged through
#                        the API). Otherwise (token
#                        mode) CI is started with workflow_dispatch, the PR is
#                        squash-merged through the API, and the post-merge
#                        workflows are dispatched by hand, because pushes and
#                        merges made with GITHUB_TOKEN trigger nothing.
#   IGNORE_MAIN_RED=true keep landing even when the latest main CI run failed
set -uo pipefail

REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
DRY="${DRY_RUN:-false}"
KEY_MODE="${TRAIN_KEY_MODE:-false}"
STOP=false
MAX_ATTEMPTS="${MAX_ATTEMPTS:-4}"
# Files that every PR may touch; ignored by the "did main move under me" check.
SHARED_RE='^(CHANGELOG\.md|TASKS\.md|changelog\.d/|tasks\.d/)'
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
# Identity of every commit the train creates; the trailer exempts them from check-fragments.sh.
TRAIN_NAME="Thomas McFarlane"
TRAIN_EMAIL="thomas@mcfarlane.email"
TRAIN_TRAILER="Merge-Train: yes"

log() { echo "[train] $*"; echo "- $*" >>"$SUMMARY"; }
run() { if [ "$DRY" = true ]; then echo "[dry-run] $*"; else "$@"; fi; }

block() { # <pr> <reason>
  local pr="$1" reason="$2"
  log "PR #$pr blocked: $reason"
  if [ "$DRY" = true ]; then return; fi
  gh pr edit "$pr" --repo "$REPO" --remove-label ready --add-label blocked >/dev/null 2>&1
  gh pr comment "$pr" --repo "$REPO" --body "Merge train: removed \`ready\` and added \`blocked\`.

$reason

Fix the cause, push, then re-add the \`ready\` label (and remove \`blocked\`) to re-enter the queue." >/dev/null
}

ensure_labels() {
  [ "$DRY" = true ] && return
  gh label create ready --repo "$REPO" --color 0E8A16 --description "Queued for the merge train" >/dev/null 2>&1 || true
  gh label create blocked --repo "$REPO" --color B60205 --description "Removed from the merge train; see comment" >/dev/null 2>&1 || true
}

ready_queue() { # prints PR numbers, oldest `ready` label first
  local n t
  for n in $(gh pr list --repo "$REPO" --label ready --state open --json number --jq '.[].number'); do
    t=$(gh api "repos/$REPO/issues/$n/events" --paginate \
      --jq '[.[]|select(.event=="labeled" and .label.name=="ready")|.created_at]|last' | tail -n1)
    echo "${t:-9999} $n"
  done | sort | awk '{print $2}'
}

main_is_red() {
  local c
  c=$(gh run list --repo "$REPO" --workflow ci.yml --branch main --status completed --limit 1 \
    --json conclusion --jq '.[0].conclusion' 2>/dev/null)
  [ "$c" = failure ]
}

# ci_state <sha>: pending | success | failure | none. Uses the CI workflow runs for the
# SHA (cancelled runs ignored) and then confirms the `ci-required` check run itself.
ci_state() {
  local runs chk
  runs=$(gh api "repos/$REPO/actions/runs?head_sha=$1&per_page=50" \
    --jq '[.workflow_runs[]|select(.path==".github/workflows/ci.yml" and .event!="push")|(.status+":"+(.conclusion//""))]|join(" ")' 2>/dev/null)
  case " $runs " in
    *" in_progress:"* | *" queued:"* | *" waiting:"* | *" pending:"* | *" requested:"*) echo pending; return ;;
  esac
  chk=$(gh api "repos/$REPO/commits/$1/check-runs?per_page=100" \
    --jq '[.check_runs[]|select(.name=="ci-required")|(.status+":"+(.conclusion//""))]|join(" ")' 2>/dev/null)
  case " $chk " in *" completed:success "*) echo success; return ;; esac
  case " $chk " in *" completed:failure "* | *" completed:timed_out "*) echo failure; return ;; esac
  [ -z "$runs" ] && { echo none; return; }
  case " $runs " in *" completed:failure "* | *" completed:timed_out "*) echo failure ;; *) echo none ;; esac
}

changed_between() { git diff --name-only "$1" "$2" | grep -Ev "$SHARED_RE" | sort -u || true; }

# remerge_needed <main-ref> <head-ref>: succeeds when main must be merged into the head
# (main's commits since the merge base touch files the PR touches, or merging conflicts).
remerge_needed() {
  local mb overlap
  mb=$(git merge-base "$1" "$2") || return 0
  overlap=$(comm -12 <(changed_between "$mb" "$2") <(changed_between "$mb" "$1"))
  [ -n "$overlap" ] && return 0
  git merge-tree --write-tree "$1" "$2" >/dev/null 2>&1 || return 0
  return 1
}

# How many recent main commits (first parent) landing_guard checks for reverts.
REVERT_WINDOW="${REVERT_WINDOW:-50}"

# expected_tree <main> <head>: the tree landing <head> on <main> must produce (a
# fast-forward when <head> contains <main>, else the clean three-way merge GitHub's
# squash merge performs). Fails on a conflict.
expected_tree() {
  local out
  if git merge-base --is-ancestor "$1" "$2"; then git rev-parse "$2^{tree}"; return; fi
  out=$(git merge-tree --write-tree --no-messages "$1" "$2" 2>/dev/null) || return 1
  printf '%s\n' "${out%%$'\n'*}"
}

# train_squash <main> <message args...>: squash HEAD into one commit on top of <main>.
# Refuses unless HEAD already contains <main>: re-parenting a tree built on an older
# main onto the current one silently reverts every main commit it lacks.
train_squash() {
  local m="$1"; shift
  git merge-base --is-ancestor "$m" HEAD || { echo "HEAD does not contain main $m; refusing to squash" >&2; return 1; }
  git reset -q --soft "$m"
  git commit -q "$@"
}

# landing_guard <main> <head>: succeeds when landing <head> on <main> yields exactly
# main plus the PR's own diff. Otherwise prints the reasons and fails. Checks:
#   - the landing changes no file the PR's own diff (merge-base..head) leaves alone;
#   - no changed path (fragments excepted: folding deletes them) is restored to the
#     version, or the absence, it had before one of main's last REVERT_WINDOW commits
#     changed it, which is what a revert looks like;
#   - lines those commits added to CHANGELOG.md or TASKS.md survive (a TASKS.md row
#     may be replaced by a row with the same number).
# A deliberate revert of a recent change therefore cannot go through the train.
landing_guard() {
  local m="$1" h="$2" lt mb p c cur prev bad="" extra changed range since
  lt=$(expected_tree "$m" "$h") || { echo "- merging \`$h\` onto main \`$m\` conflicts"; return 1; }
  mb=$(git merge-base "$m" "$h")
  range="$m"; since=$(git rev-list --first-parent --skip="$REVERT_WINDOW" -n1 "$m")
  [ -n "$since" ] && range="$since..$m"
  changed=$(git diff --name-only --no-renames "$m" "$lt")
  extra=$(comm -23 <(sort -u <<<"$changed" | sed '/^$/d') <(git diff --name-only --no-renames "$mb" "$h" | sort -u))
  [ -n "$extra" ] && bad+="$(sed 's/^/- changes `/;s/$/`, which the PR does not touch/' <<<"$extra")"$'\n'
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    grep -qE "$SHARED_RE" <<<"$p" && continue
    cur=$(git rev-parse -q --verify "$lt:$p" 2>/dev/null) || cur=absent
    for c in $(git log --first-parent --format=%H "$range" -- "$p"); do
      prev=$(git rev-parse -q --verify "$c^:$p" 2>/dev/null) || prev=absent
      if [ "$cur" = "$prev" ]; then
        bad+="- \`$p\` would be reverted to its state before $(git log -1 --format='%h (%s)' "$c")"$'\n'
        break
      fi
    done
  done <<<"$changed"
  local f lost
  for f in CHANGELOG.md TASKS.md; do
    grep -qx "$f" <<<"$changed" || continue
    lost=$(comm -12 \
      <(for c in $(git log --first-parent --format=%H "$range" -- "$f"); do
          git diff "$c^" "$c" -- "$f" 2>/dev/null | sed -n 's/^+\([^+].*\)$/\1/p'
        done | grep -v '^[[:space:]]*$' | sort -u) \
      <(git show "$m:$f" | sort -u) | comm -23 - <(git show "$lt:$f" 2>/dev/null | sort -u))
    if [ "$f" = TASKS.md ] && [ -n "$lost" ]; then
      # A fragment replaces a row in place: a lost row is fine when its number is still on the board.
      local rows; rows=$(git show "$lt:$f" 2>/dev/null | sed -n 's/^| *\([0-9][0-9]*\) *|.*/\1/p' | sort -u)
      lost=$(while IFS= read -r line; do
        n=$(sed -n 's/^| *\([0-9][0-9]*\) *|.*/\1/p' <<<"$line")
        [ -n "$n" ] && grep -qx "$n" <<<"$rows" && continue
        printf '%s\n' "$line"
      done <<<"$lost")
    fi
    [ -n "$lost" ] && bad+="- \`$f\` would lose $(grep -c . <<<"$lost") line(s) recent main commits added, e.g. \`$(head -n1 <<<"$lost" | cut -c1-120)\`"$'\n'
  done
  [ -z "$bad" ] && return 0
  printf '%s' "$bad"
  return 1
}

# verify_landed <landed-sha> <head>: the landed commit's tree must be exactly its parent
# (the main GitHub merged onto) plus <head>'s changes.
verify_landed() {
  local want
  want=$(expected_tree "$1^" "$2") || return 1
  [ "$want" = "$(git rev-parse "$1^{tree}")" ]
}

post_merge_dispatch() { # <merged-sha> <files...>; token mode only
  local sha="$1" files
  files=$(git diff-tree --no-commit-id --name-only -r "$sha")
  run gh workflow run ci.yml --repo "$REPO" --ref main
  if grep -qE '^(backend/|clients/tv-web/|infra/docker/backend\.Dockerfile|\.github/workflows/regional-image\.yml)' <<<"$files"; then
    run gh workflow run regional-image.yml --repo "$REPO" --ref main
  fi
  if grep -qE '^(docs/|mkdocs\.yml|\.github/workflows/docs\.yml)' <<<"$files"; then
    run gh workflow run docs.yml --repo "$REPO" --ref main
  fi
  if grep -qE '^clients/android/' <<<"$files"; then
    log "Android sources landed: android-play-internal.yml needs a version input and was NOT dispatched; run it manually or enable key mode."
  fi
}

process() { # <pr>
  local pr="$1" info br title body base cross draft attempt=0
  info=$(gh pr view "$pr" --repo "$REPO" --json headRefName,isCrossRepository,isDraft,title,body,baseRefName,state) || {
    log "PR #$pr: cannot read, skipping"; return; }
  [ "$(jq -r .state <<<"$info")" = OPEN ] || { log "PR #$pr not open, skipping"; return; }
  br=$(jq -r .headRefName <<<"$info"); title=$(jq -r .title <<<"$info"); body=$(jq -r .body <<<"$info")
  base=$(jq -r .baseRefName <<<"$info"); cross=$(jq -r .isCrossRepository <<<"$info"); draft=$(jq -r .isDraft <<<"$info")
  [ "$cross" = true ] && { block "$pr" "Pull requests from forks cannot be trained."; return; }
  [ "$draft" = true ] && { block "$pr" "The pull request is a draft."; return; }
  [ "$base" = main ] || { block "$pr" "Base branch is \`$base\`, not \`main\`."; return; }
  log "PR #$pr ($br): start"

  while [ "$attempt" -lt "$MAX_ATTEMPTS" ]; do
    attempt=$((attempt + 1))
    git fetch -q origin main "+refs/heads/$br:refs/remotes/origin/$br" || { block "$pr" "Could not fetch branch \`$br\`."; return; }
    local main head newhead rc
    main=$(git rev-parse origin/main); head=$(git rev-parse "origin/$br")
    git checkout -q -B train-work "origin/$br"

    local ncommits need_push=false remerge=false contains_main=true has_fragments=false
    ncommits=$(git rev-list --count "$main..HEAD")
    [ -n "$(find changelog.d tasks.d -name '*.md' ! -iname README.md 2>/dev/null)" ] && has_fragments=true
    git merge-base --is-ancestor "$main" HEAD || contains_main=false
    if [ "$contains_main" = false ] && remerge_needed "$main" HEAD; then remerge=true; fi
    if [ "$has_fragments" = true ] || { [ "$KEY_MODE" = true ] && [ "$ncommits" -gt 1 ]; }; then need_push=true; fi

    if [ "$need_push" = true ] && [ "$remerge" != true ] && [ "$DRY" != true ] \
      && [ "$(ci_state "$head")" = pending ]; then
      # Never replace a head whose CI is queued or running unless a re-merge is required.
      log "PR #$pr: ci-required running on $head and no re-merge needed; not replacing it, the next trigger resumes"
      STOP=true; return
    fi

    # A head the train rewrites (fold, squash) is always built on the current main, so
    # the squash below is main + the PR. Only an untouched head may lag behind main;
    # the API squash merge then lands it three-way onto main.
    if [ "$contains_main" = false ] && { [ "$remerge" = true ] || [ "$need_push" = true ]; }; then
      if ! git merge -q --no-edit -m "chore(train): merge main into $br" "$main" >/tmp/train-merge.log 2>&1; then
        local files; files=$(git diff --name-only --diff-filter=U | head -20 | sed 's/^/- `/;s/$/`/')
        git merge --abort 2>/dev/null
        block "$pr" "Merging the latest \`main\` into \`$br\` conflicts in:

$files"
        return
      fi
      need_push=true
    elif [ "$contains_main" = false ]; then
      log "PR #$pr: main moved independently of this PR; keeping the tested head"
    fi
    # Fold changelog.d/ and tasks.d/ fragments into CHANGELOG.md and TASKS.md on the branch, so the
    # folded result is what CI validates and what lands (no post-merge commit on main).
    if [ "$has_fragments" = true ]; then
      if ! node scripts/fold-fragments.mjs >/tmp/train-fold.log 2>&1; then
        git checkout -q -- . 2>/dev/null; git clean -fdq changelog.d tasks.d 2>/dev/null
        block "$pr" "Invalid changelog or task fragments:

\`\`\`
$(head -c 1500 /tmp/train-fold.log)
\`\`\`"
        return
      fi
      git add -A CHANGELOG.md TASKS.md changelog.d tasks.d
      git commit -q -m "chore(train): fold fragments for #$pr" || true
    fi
    if git grep -qE '^(<<<<<<< |>>>>>>> )' -- ':!*.lock' ':!*.snap'; then
      block "$pr" "Conflict markers are present after merging \`main\`:

$(git grep -lE '^(<<<<<<< |>>>>>>> )' -- ':!*.lock' ':!*.snap' | head -10 | sed 's/^/- `/;s/$/`/')"
      return
    fi

    # Public repository rule: GitHub-hosted runners only, whatever CI says (the tree here is main merged with the PR).
    if ! hosted_out=$(scripts/ci/check-hosted-runners.sh 2>&1); then
      block "$pr" "The resulting tree targets a runner that is not GitHub-hosted, which this public repository forbids (use \`runs-on: ubuntu-latest\`, \`windows-latest\` or \`macos-latest\`):

\`\`\`
$(printf '%s' "$hosted_out" | head -c 1500)
\`\`\`"
      return
    fi

    if [ "$need_push" = true ]; then
      if [ "$KEY_MODE" = true ]; then
        # Squash to one commit on top of main so main stays linear and the PR
        # head SHA is exactly what CI validates and what lands. HEAD contains
        # main here (merged above); train_squash refuses otherwise.
        train_squash "$main" -m "$title (#$pr)" -m "$body" -m "$TRAIN_TRAILER" 2>/tmp/train-squash.log \
          || { block "$pr" "Squashing failed: $(head -c 300 /tmp/train-squash.log) (or nothing to commit: empty change)."; return; }
      fi
      newhead=$(git rev-parse HEAD)
      log "PR #$pr: pushing $newhead (attempt $attempt)"
      if [ "$DRY" != true ]; then
        if ! git push -q origin "HEAD:refs/heads/$br" --force-with-lease="refs/heads/$br:$head" 2>/tmp/train-push.log; then
          if grep -qi 'workflow' /tmp/train-push.log; then
            block "$pr" "GITHUB_TOKEN may not push workflow-file changes that arrive with the latest \`main\`. Merge \`main\` into the branch yourself and push, or install the TRAIN_DEPLOY_KEY secret (see AGENTS.md)."
            return
          fi
          log "PR #$pr: push rejected ($(head -c 200 /tmp/train-push.log)), retrying"; continue
        fi
      fi
      head="$newhead"
      if [ "$DRY" = true ]; then
        log "PR #$pr: dry run stops here (ci-required on $head would be checked on the next trigger)"
        return
      fi
    fi

    local st; st=$(ci_state "$head")
    if [ "$DRY" = true ]; then
      log "PR #$pr: dry run, branch already contains main; ci-required on $head is: $st; would land if success"; return
    fi
    case "$st" in
      pending) log "PR #$pr: ci-required running on $head; the next trigger (CI completion or schedule) resumes"; STOP=true; return ;;
      none)
        # Pushes made with GITHUB_TOKEN trigger nothing, so start CI explicitly.
        if [ "$KEY_MODE" = true ] && [ $(( $(date +%s) - $(git log -1 --format=%ct "$head") )) -lt 600 ]; then
          log "PR #$pr: no CI run registered yet for $head (pushed moments ago), waiting"
        else
          log "PR #$pr: no CI run for $head, dispatching"
          run gh workflow run ci.yml --repo "$REPO" --ref "$br"
        fi
        STOP=true; return ;;
      failure) block "$pr" "\`ci-required\` failed on \`$head\`. See the checks on the pull request."; return ;;
    esac

    # CI is green on $head. Has main moved since it was validated?
    git fetch -q origin main
    local nmain; nmain=$(git rev-parse origin/main)
    local ff=true
    if ! git merge-base --is-ancestor "$nmain" "$head"; then
      if remerge_needed "$nmain" "$head"; then
        log "PR #$pr: main moved and overlaps or conflicts, repeating"
        continue
      fi
      log "PR #$pr: main moved but is independent of this PR, landing the tested head"
      ff=false
    fi

    # Hard safety check: the landing must be exactly current main plus the PR's own diff.
    local guard
    if ! guard=$(landing_guard "$nmain" "$head"); then
      block "$pr" "Landing guard: landing \`$head\` on \`main\` (\`$nmain\`) would change more than this PR's own diff:

$guard
If this is intended (for example a deliberate revert), land it manually under merge rule v2."
      log "PR #$pr: landing guard refused; train stopped for inspection"
      STOP=true; return
    fi

    if [ "$KEY_MODE" = true ] && [ "$ff" = true ]; then
      # main must fast-forward to $head; the push fails otherwise.
      if ! git push -q origin "$head:refs/heads/main"; then
        log "PR #$pr: main moved during landing, repeating"; continue
      fi
      git push -q origin --delete "$br" 2>/dev/null || true
      log "PR #$pr: landed as $head"
    else
      if ! gh pr merge "$pr" --repo "$REPO" --squash --match-head-commit "$head" \
        --subject "$title (#$pr)" --body "$body

$TRAIN_TRAILER" --delete-branch >/tmp/train-merge-api.log 2>&1; then
        log "PR #$pr: API merge failed ($(head -c 200 /tmp/train-merge-api.log)), repeating"; continue
      fi
      git fetch -q origin main
      local merged; merged=$(git rev-parse origin/main)
      if ! verify_landed "$merged" "$head"; then
        log "PR #$pr: LANDED TREE MISMATCH: $merged is not its parent plus $head; train stopped"
        gh pr comment "$pr" --repo "$REPO" --body "Merge train: squash-merged as $merged, but its tree is not \`main\` plus this PR's changes. The train has stopped; inspect \`git diff $merged^ $merged\` and restore anything lost." >/dev/null
        STOP=true; exit 1
      fi
      post_merge_dispatch "$merged"
      log "PR #$pr: landed as $merged"
    fi
    return
  done
  block "$pr" "Gave up after $MAX_ATTEMPTS attempts because \`main\` kept moving or pushes were rejected."
}

main() {
  git config user.name "$TRAIN_NAME"
  git config user.email "$TRAIN_EMAIL"
  ensure_labels
  echo "### Merge train (dry_run=$DRY, key_mode=$KEY_MODE)" >>"$SUMMARY"
  if [ "${IGNORE_MAIN_RED:-false}" != true ] && [ "$DRY" != true ] && main_is_red; then
    log "Latest completed CI run on main failed: train paused. Fix main (or set IGNORE_MAIN_RED) first."
    exit 0
  fi
  local queue pr
  if [ -n "${ONLY_PR:-}" ]; then queue="$ONLY_PR"; else queue=$(ready_queue); fi
  [ -z "$queue" ] && { log "queue empty"; exit 0; }
  for pr in $queue; do
    if [ "$DRY" != true ]; then
      # Re-check the label: an agent may have withdrawn it while we waited.
      gh pr view "$pr" --repo "$REPO" --json labels --jq '.labels[].name' | grep -qx ready || { log "PR #$pr no longer ready"; continue; }
    fi
    process "$pr"
    # A PR waiting on CI holds the head of the queue: stop instead of holding a runner.
    if [ "$STOP" = true ]; then break; fi
  done
  exit 0
}

# Sourcing the file (tests) only defines the functions.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  for tool in gh git jq; do command -v "$tool" >/dev/null || { echo "[train] missing required tool: $tool" >&2; exit 1; }; done
  main "$@"
fi
