#!/usr/bin/env bash
# Tests scripts/ci/check-public-screenshots.sh in a throwaway repository.
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "${tmp}"' EXIT
cd "${tmp}"
git init -q -b main . && git config user.email t@example.com && git config user.name t
mkdir -p scripts/ci scripts/showcase docs/assets/readme/screenshots
cp "${here}/scripts/ci/check-public-screenshots.sh" scripts/ci/
cp "${here}/scripts/showcase/manifest.mjs" scripts/showcase/
printf 'one' >docs/assets/readme/screenshots/a.png
node scripts/showcase/manifest.mjs --write >/dev/null
git add -A && git commit -qm base && git update-ref refs/remotes/origin/main HEAD
export GITHUB_EVENT_NAME=pull_request BASE_REF=main
fail() { echo "FAIL: $*" >&2; exit 1; }
run() { scripts/ci/check-public-screenshots.sh >/dev/null 2>&1; }

run || fail "clean tree must pass"
printf 'two' >docs/assets/readme/screenshots/a.png
run && fail "a hand-replaced screenshot must fail"
node scripts/showcase/manifest.mjs --write >/dev/null
git add -A && git commit -qm retake
run || fail "a screenshot retaken with the showcase manifest must pass"
printf 'three' >docs/assets/readme/screenshots/b.png
run && fail "a new screenshot missing from the manifest must fail"
rm docs/assets/readme/screenshots/b.png
# Changed screenshot without any scripts/showcase change in the PR must fail even if hashes are forged elsewhere.
git checkout -q -b noshowcase origin/main
printf 'four' >docs/assets/readme/screenshots/a.png
git add -A && git commit -qm sneaky
cp scripts/showcase/screenshots.sha256 /dev/null
run && fail "a PR touching a screenshot but not the showcase must fail"
echo "check-public-screenshots tests ok"
