#!/usr/bin/env bash
#
# scripts/release.sh
#
# Cuts a release for one component of the Playarr Server monorepo: bumps that
# component's version file (if one exists yet), commits the bump, and
# creates an annotated git tag using the repo's tag scheme:
#
#   backend-vX.Y.Z          the Rust backend (backend/Cargo.toml [workspace.package].version)
#   android-vX.Y.Z   clients/android (gradle.properties VERSION_NAME, if present)
#   ios-vX.Y.Z              clients/ios (a top-level VERSION file, if present --
#                            Xcode/SPM projects don't have one canonical
#                            version field the way Cargo/Gradle/npm do)
#   tv-web-vX.Y.Z           clients/tv-web (package.json version)
#
# Each client component is tagged and versioned independently of the
# backend and of each other -- see docs/versioning-policy.md for how tags
# map to what a client build actually ships.
#
# IMPORTANT: by default this script does NOT push the tag. It prints the
# exact `git push` command as the deliberate next step, so cutting a release
# is always a separate, conscious action -- pass --push if you want this
# invocation to also push (still asks for confirmation unless --yes is
# also given).
#
# Usage:
#   ./scripts/release.sh backend 1.4.0
#   ./scripts/release.sh tv-web 0.3.0 --dry-run
#   ./scripts/release.sh android 2.1.0-rc.1 --push
#   ./scripts/release.sh ios 1.0.0 --push --yes   # push without a confirmation prompt (e.g. CI)
#
# Flags:
#   --dry-run   print every step without changing anything (no file edits,
#               no commit, no tag, no push)
#   --push      also run `git push origin <tag>` after tagging
#   --yes       skip the confirmation prompt before pushing (implies you've
#               already decided; only meaningful with --push)
#
# NOTE: this script is authored as scaffolding and is NOT executed as part
# of building this repo -- doing so would create a real commit/tag in a
# repo that isn't ready to be released yet.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

usage() {
  grep -E '^#( |$)' "${BASH_SOURCE[0]}" | sed -E 's/^# ?//'
  exit "${1:-0}"
}

if [[ $# -lt 2 ]]; then
  usage 1
fi

COMPONENT="$1"
VERSION="$2"
shift 2

DRY_RUN=0
PUSH=0
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --push) PUSH=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    -h|--help) usage 0 ;;
    *)
      echo "release.sh: unknown argument: $1" >&2
      usage 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Validate inputs
# ---------------------------------------------------------------------------
# Deliberately NOT a `declare -A` associative array: macOS ships bash 3.2
# (associative arrays need 4.0+), and this script has no other reason to
# require a newer bash, so a plain case statement keeps it running
# unmodified under whatever `bash` a contributor's `env` resolves to.
KNOWN_COMPONENTS="backend android ios tv-web"

version_file_for() {
  case "$1" in
    backend) echo "backend/Cargo.toml" ;;
    android) echo "clients/android/gradle.properties" ;;
    ios) echo "clients/ios/VERSION" ;;
    tv-web) echo "clients/tv-web/package.json" ;;
    *) return 1 ;;
  esac
}

if ! version_file_for "${COMPONENT}" >/dev/null; then
  echo "release.sh: unknown component '${COMPONENT}'" >&2
  echo "            expected one of: ${KNOWN_COMPONENTS}" >&2
  exit 1
fi

if ! [[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "release.sh: '${VERSION}' is not a valid semver (expected X.Y.Z or X.Y.Z-prerelease)" >&2
  exit 1
fi

TAG="${COMPONENT}-v${VERSION}"

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null 2>&1; then
  echo "release.sh: tag ${TAG} already exists" >&2
  exit 1
fi

if git rev-parse -q --verify HEAD >/dev/null 2>&1; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "release.sh: working tree is not clean -- commit or stash changes before releasing" >&2
    git status --short >&2
    exit 1
  fi
else
  echo "release.sh: repo has no commits yet -- nothing to tag" >&2
  exit 1
fi

run() {
  echo "+ $*"
  if [[ "${DRY_RUN}" -ne 1 ]]; then
    "$@"
  fi
}

echo "==> Releasing ${COMPONENT} ${VERSION} (tag: ${TAG})"

# ---------------------------------------------------------------------------
# Bump the version file, if it exists. Every component here is owned by a
# different concurrently-developed part of the repo, so at any given time
# the file this script would bump may not have been scaffolded yet -- that
# is not an error, it just means this release is tag-only for now.
# ---------------------------------------------------------------------------
version_file="$(version_file_for "${COMPONENT}")"
bumped=0

if [[ ! -f "${version_file}" ]]; then
  echo "==> ${version_file} does not exist yet -- skipping in-place version bump, tagging only"
else
  case "${COMPONENT}" in
    backend)
      # backend/Cargo.toml doubles as both the workspace root manifest AND
      # the `playarr-bin` package manifest (see the comment at the top of
      # that file), so there are two `version = "..."` fields to keep in
      # sync: the workspace-wide one under [workspace.package] (which
      # member crates using `version.workspace = true` inherit) and the
      # binary's own version under [package] (hardcoded, not inherited).
      # Each sed range is bounded by the *next* `[section]` header so we
      # never touch an inline-table `version = "1"` inside a dependency spec
      # further down the file (those lines don't start with `version `
      # anyway, but the range bound is cheap extra safety).
      run sed -i.bak -E \
        -e "/^\[package\]/,/^\[/ s/^version = \"[^\"]*\"/version = \"${VERSION}\"/" \
        -e "/^\[workspace\.package\]/,/^\[/ s/^version = \"[^\"]*\"/version = \"${VERSION}\"/" \
        "${version_file}"
      run rm -f "${version_file}.bak"
      bumped=1
      ;;
    android)
      if grep -q '^VERSION_NAME=' "${version_file}"; then
        run sed -i.bak -E "s/^VERSION_NAME=.*/VERSION_NAME=${VERSION}/" "${version_file}"
      else
        run bash -c "printf '\nVERSION_NAME=%s\n' '${VERSION}' >> '${version_file}'"
      fi
      run rm -f "${version_file}.bak"
      bumped=1
      ;;
    ios)
      run bash -c "printf '%s\n' '${VERSION}' > '${version_file}'"
      bumped=1
      ;;
    tv-web)
      require_cmd() { command -v "$1" >/dev/null 2>&1; }
      if require_cmd jq; then
        run bash -c "jq '.version = \"${VERSION}\"' '${version_file}' > '${version_file}.tmp' && mv '${version_file}.tmp' '${version_file}'"
      else
        echo "release.sh: jq not found -- edit ${version_file}'s \"version\" field to ${VERSION} manually, then re-run with --push only" >&2
        exit 1
      fi
      bumped=1
      ;;
  esac
fi

# ---------------------------------------------------------------------------
# Commit the bump (only if we actually changed something) and tag.
# ---------------------------------------------------------------------------
if [[ "${bumped}" -eq 1 ]]; then
  run git add "${version_file}"
  run git commit -m "chore(${COMPONENT}): release ${VERSION}"
fi

run git tag -a "${TAG}" -m "${COMPONENT} ${VERSION}"

echo
echo "==> Tag ${TAG} created locally."
echo "    Next step (deliberately not automatic) -- push it:"
echo "      git push origin ${TAG}"
if [[ "${bumped}" -eq 1 ]]; then
  echo "    and the commit that carries it, if not already pushed:"
  echo "      git push origin HEAD"
fi

if [[ "${PUSH}" -eq 1 ]]; then
  if [[ "${ASSUME_YES}" -ne 1 && "${DRY_RUN}" -ne 1 ]]; then
    read -r -p "    Push ${TAG} (and HEAD) to origin now? [y/N] " reply
    if [[ ! "${reply}" =~ ^[Yy]$ ]]; then
      echo "    Not pushing. Run the commands above manually when ready."
      exit 0
    fi
  fi
  run git push origin HEAD
  run git push origin "${TAG}"
fi
