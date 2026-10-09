#!/usr/bin/env bash
# Tests scripts/fold-main.sh (post-merge fold of direct merges) against a throwaway bare origin.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }

git init -q --bare -b main "$tmp/origin.git"
git clone -q "$tmp/origin.git" "$tmp/seed" 2>/dev/null
cd "$tmp/seed"; git config user.name t; git config user.email t@example.invalid
mkdir -p scripts/lib tasks.d changelog.d
cp "$root/scripts/fold-fragments.mjs" "$root/scripts/fold-main.sh" scripts/; cp "$root"/scripts/lib/*.mjs scripts/lib/
printf '# Tasks\n\n## Active\n\n| ID | Task | Status | Owner | Branch | Depends | ETA | Notes |\n|---|---|---|---|---|---|---|---|\n| 1 | One | todo | a | | | | b |\n' >TASKS.md
printf '# Changelog\n\n## [Unreleased]\n\n## [1.0.0]\n' >CHANGELOG.md
printf 'readme\n' >tasks.d/README.md; printf 'readme\n' >changelog.d/README.md
git add -A; git commit -qm base; git push -q origin HEAD:main

new_clone() { rm -rf "$tmp/$1"; git clone -q "$tmp/origin.git" "$tmp/$1" 2>/dev/null; git -C "$tmp/$1" config user.name t; git -C "$tmp/$1" config user.email t@example.invalid; }

# 1. A directly merged PR leaves fragments; the fold lands one commit with identity, trailer and no fragments.
cd "$tmp/seed"
printf '| 1 | One | done | a | | | | b |\n' >tasks.d/1.md
printf 'section: Active\n| 2 | Two | todo | a | | | | b |\n' >tasks.d/2.md
printf -- '- Added a thing.\n' >changelog.d/thing.added.md
git add -A; git commit -qm "direct merge"; git push -q origin HEAD:main
new_clone w1
(cd "$tmp/w1" && scripts/fold-main.sh >/dev/null)
new_clone v1; cd "$tmp/v1"
grep -q '^| 1 | One | done |' TASKS.md && grep -q '^| 2 | Two | todo |' TASKS.md && ok "rows folded onto main" || bad "rows folded onto main"
grep -q 'Added a thing' CHANGELOG.md && ok "changelog folded" || bad "changelog folded"
[ "$(ls tasks.d changelog.d | grep -c '\.md$')" = 2 ] && ok "only READMEs left" || bad "only READMEs left"
[ "$(git log -1 --format=%an)" = "Thomas McFarlane" ] && git log -1 --format=%B | grep -qx 'Merge-Train: yes' && ok "train identity and trailer" || bad "train identity and trailer"

# 2. Nothing pending: no new commit.
before=$(git rev-parse HEAD)
(cd "$tmp/w1" && scripts/fold-main.sh | grep -q 'no pending') && [ "$(git ls-remote "$tmp/origin.git" main | cut -f1)" = "$before" ] && ok "no-op without fragments" || bad "no-op without fragments"

# 3. Push race: main moves between fetch and push; the fold retries on the new main.
cd "$tmp/seed"; git pull -q origin main; printf 'section: Active\n| 3 | Three | todo | a | | | | b |\n' >tasks.d/3.md; git add -A; git commit -qm "direct merge 2"; git push -q origin HEAD:main
new_clone w2
cat >"$tmp/origin.git/hooks/pre-receive" <<HOOK
#!/usr/bin/env bash
if [ ! -e "$tmp/raced" ]; then touch "$tmp/raced"; echo "simulated race" >&2; exit 1; fi
HOOK
chmod +x "$tmp/origin.git/hooks/pre-receive"
(cd "$tmp/w2" && scripts/fold-main.sh >/dev/null 2>&1) && new_clone v2 && grep -q '^| 3 | Three' "$tmp/v2/TASKS.md" && ok "retries after a rejected push" || bad "retries after a rejected push"
rm "$tmp/origin.git/hooks/pre-receive"

# 4. Board-sync shape: a local fragment commit ahead of main is rebased, folded and pushed.
new_clone w3; cd "$tmp/w3"
printf '| 3 | Three | done | a | | | | b |\n' >tasks.d/3.md; git add -A; git commit -qm "docs(board): rows 3"
scripts/fold-main.sh >/dev/null
new_clone v3
grep -q '^| 3 | Three | done |' "$tmp/v3/TASKS.md" && [ ! -e "$tmp/v3/tasks.d/3.md" ] && ok "local fragment commit folded and pushed" || bad "local fragment commit folded and pushed"

# 5. Invalid fragment fails loudly and pushes nothing.
cd "$tmp/seed"; git pull -q origin main; printf 'garbage\n' >tasks.d/9.md; git add -A; git commit -qm bad; git push -q origin HEAD:main
new_clone w4; head=$(git -C "$tmp/w4" rev-parse HEAD)
if (cd "$tmp/w4" && scripts/fold-main.sh >/dev/null 2>&1); then bad "invalid fragment fails"; else [ "$(git ls-remote "$tmp/origin.git" main | cut -f1)" = "$head" ] && ok "invalid fragment fails and pushes nothing" || bad "invalid fragment pushed"; fi

# 6. Workflows: board-sync must not open PRs (Actions may not), and the push fold must exist.
grep -q 'gh pr create' "$root/.github/workflows/board-sync.yml" && bad "board-sync opens no PR" || ok "board-sync opens no PR"
grep -q 'scripts/fold-main.sh' "$root/.github/workflows/board-sync.yml" && grep -q 'scripts/fold-main.sh' "$root/.github/workflows/fold-board.yml" && ok "workflows call fold-main.sh" || bad "workflows call fold-main.sh"

exit $fail
