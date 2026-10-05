#!/usr/bin/env bash
# Merge train: lands pull requests labelled `ready` one at a time, oldest first.
#
# Equivalent of GitHub's native merge queue (unavailable for private repos on a
# personal account). For each ready PR it:
#   1. merges the latest main into the PR branch (blocks on conflicts),
#   2. pushes and waits for `ci-required` on that exact head SHA,
#   3. lands it only if main has not moved in a way that could invalidate the
#      result (otherwise repeats from 1),
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
#                        and main is fast-forwarded to it. Otherwise (token
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
for tool in gh git jq; do command -v "$tool" >/dev/null || { echo "[train] missing required tool: $tool" >&2; exit 1; }; done

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

changed_between() { git diff --name-only "$1" "$2" | grep -Ev "$SHARED_RE" || true; }

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

    local ncommits need_push=false
    ncommits=$(git rev-list --count "origin/main..HEAD")
    if ! git merge-base --is-ancestor "$main" HEAD; then
      if ! git merge -q --no-edit -m "chore(train): merge main into $br" origin/main >/tmp/train-merge.log 2>&1; then
        local files; files=$(git diff --name-only --diff-filter=U | head -20 | sed 's/^/- `/;s/$/`/')
        git merge --abort 2>/dev/null
        block "$pr" "Merging the latest \`main\` into \`$br\` conflicts in:

$files"
        return
      fi
      need_push=true
    fi
    if [ "$KEY_MODE" = true ] && [ "$ncommits" -gt 1 ]; then need_push=true; fi
    if git grep -qE '^(<<<<<<< |>>>>>>> )' -- ':!*.lock' ':!*.snap'; then
      block "$pr" "Conflict markers are present after merging \`main\`:

$(git grep -lE '^(<<<<<<< |>>>>>>> )' -- ':!*.lock' ':!*.snap' | head -10 | sed 's/^/- `/;s/$/`/')"
      return
    fi

    if [ "$need_push" = true ]; then
      if [ "$KEY_MODE" = true ]; then
        # Squash to one commit on top of main so main stays linear and the PR
        # head SHA is exactly what CI validates and what lands.
        git reset -q --soft origin/main
        git -c user.name="playarr-merge-train" -c user.email="thomas@mcfarlane.email" \
          commit -q -m "$title (#$pr)" -m "$body" || { block "$pr" "Nothing to commit after squashing (empty change)."; return; }
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
    if ! git merge-base --is-ancestor "$nmain" "$head"; then
      local overlap pr_files
      pr_files=$(git diff --name-only "origin/main...$head" | grep -Ev "$SHARED_RE" || true)
      overlap=$(comm -12 <(sort <<<"$pr_files") <(changed_between "$main" "$nmain" | sort))
      if [ -n "$overlap" ] || ! git merge-tree --write-tree "$nmain" "$head" >/dev/null 2>&1; then
        log "PR #$pr: main moved and overlaps or conflicts, repeating"
        continue
      fi
      log "PR #$pr: main moved but is independent of this PR, landing"
    fi

    if [ "$KEY_MODE" = true ]; then
      # main must fast-forward to $head; the push fails otherwise.
      if ! git push -q origin "$head:refs/heads/main"; then
        log "PR #$pr: main moved during landing, repeating"; continue
      fi
      git push -q origin --delete "$br" 2>/dev/null || true
      gh pr comment "$pr" --repo "$REPO" --body "Merge train: landed on \`main\` as $head." >/dev/null
      log "PR #$pr: landed as $head"
    else
      if ! gh pr merge "$pr" --repo "$REPO" --squash --match-head-commit "$head" \
        --subject "$title (#$pr)" --body "$body" --delete-branch >/tmp/train-merge-api.log 2>&1; then
        log "PR #$pr: API merge failed ($(head -c 200 /tmp/train-merge-api.log)), repeating"; continue
      fi
      git fetch -q origin main
      local merged; merged=$(git rev-parse origin/main)
      post_merge_dispatch "$merged"
      gh pr comment "$pr" --repo "$REPO" --body "Merge train: squash-merged as $merged." >/dev/null
      log "PR #$pr: landed as $merged"
    fi
    return
  done
  block "$pr" "Gave up after $MAX_ATTEMPTS attempts because \`main\` kept moving or pushes were rejected."
}

main() {
  git config user.name "playarr-merge-train"
  git config user.email "thomas@mcfarlane.email"
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
    [ "$STOP" = true ] && break
  done
}

main "$@"
