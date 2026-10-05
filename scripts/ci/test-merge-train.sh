#!/usr/bin/env bash
# Tests the merge-train re-merge decision and the check-fragments trailer exemption in a throwaway repo.
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
exit $fail
