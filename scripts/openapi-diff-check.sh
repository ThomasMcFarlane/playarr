#!/usr/bin/env bash
#
# scripts/openapi-diff-check.sh
#
# Diffs the working-tree OpenAPI spec (backend/openapi/streamarr.yaml)
# against the last committed/tagged version of that same file, and fails
# (non-zero exit) if the diff contains a breaking change. This is what
# CI's `openapi-contract-check` job runs on every PR that touches the spec.
#
# Baseline resolution, in order:
#   1. --base <git-ref> if given explicitly.
#   2. The most recent `backend-vX.Y.Z` tag reachable from HEAD (the release
#      tag scheme cut by scripts/release.sh).
#   3. origin/main, if it exists and differs from HEAD.
#   4. HEAD~1, as a last resort (useful for a single-commit local check).
# If none of these resolve to a commit that actually has the spec file
# (e.g. this is the PR that introduces it), the check passes trivially --
# there is nothing to have broken yet.
#
# Diff engine, in order of preference:
#   1. A local `oasdiff` binary, if installed.
#      (https://github.com/oasdiff/oasdiff -- `go install`/`brew install oasdiff/tap/oasdiff`)
#   2. `oasdiff` via Docker, if no local binary but docker is available.
#   3. A naive `diff -u` fallback: prints the textual diff but CANNOT tell
#      a breaking change from a harmless one (e.g. added an optional field
#      vs. removed a required one both just show up as "lines changed"), so
#      it always exits 0. Loudly warns that this means the CI gate is not
#      actually enforcing anything until oasdiff is available.
#
# Usage:
#   ./scripts/openapi-diff-check.sh
#   ./scripts/openapi-diff-check.sh --base backend-v1.2.0
#   ./scripts/openapi-diff-check.sh --spec backend/openapi/streamarr.yaml
#   ./scripts/openapi-diff-check.sh --changelog   # also print the full changelog, not just breaking changes
#
# Exit codes:
#   0  no baseline yet (nothing to diff), or diff ran and found no breaking changes
#   1  breaking changes detected
#   2  usage/tooling error (spec missing, git ref not found, etc.)
#
# NOTE: this script is authored as scaffolding. It requires
# backend/openapi/streamarr.yaml and at least one commit containing it to
# do anything meaningful, neither of which exists yet in this repo -- it is
# not executed as part of building this repo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

SPEC_PATH_REL="backend/openapi/streamarr.yaml"
BASE_REF=""
SHOW_CHANGELOG=0
OASDIFF_IMAGE="${OASDIFF_IMAGE:-tufin/oasdiff:latest}"

usage() {
  grep -E '^#( |$)' "${BASH_SOURCE[0]}" | sed -E 's/^# ?//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      BASE_REF="$2"
      shift 2
      ;;
    --spec)
      SPEC_PATH_REL="$2"
      shift 2
      ;;
    --changelog)
      SHOW_CHANGELOG=1
      shift
      ;;
    -h|--help)
      usage 0
      ;;
    *)
      echo "openapi-diff-check.sh: unknown argument: $1" >&2
      usage 2
      ;;
  esac
done

if [[ ! -f "${SPEC_PATH_REL}" ]]; then
  echo "openapi-diff-check.sh: spec not found at ${SPEC_PATH_REL}" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Resolve the baseline git ref
# ---------------------------------------------------------------------------
if [[ -z "${BASE_REF}" ]] && git rev-parse --verify -q HEAD >/dev/null 2>&1; then
  # Latest backend-vX.Y.Z tag reachable from HEAD, newest first by version.
  # (guarded on HEAD existing at all: `--merged HEAD` errors on a brand new
  # repo with zero commits, i.e. an unborn HEAD.)
  BASE_REF="$(git tag --list 'backend-v*' --sort=-v:refname --merged HEAD 2>/dev/null | head -n1 || true)"
fi
if [[ -z "${BASE_REF}" ]] && git rev-parse --verify -q origin/main >/dev/null; then
  if [[ "$(git rev-parse origin/main)" != "$(git rev-parse HEAD)" ]]; then
    BASE_REF="origin/main"
  fi
fi
if [[ -z "${BASE_REF}" ]] && git rev-parse --verify -q HEAD~1 >/dev/null; then
  BASE_REF="HEAD~1"
fi

if [[ -z "${BASE_REF}" ]]; then
  echo "openapi-diff-check.sh: no baseline ref found (no backend-v* tag, no origin/main, no HEAD~1)." >&2
  echo "                       Treating this as the initial contract -- nothing to diff against." >&2
  exit 0
fi

if ! git rev-parse --verify -q "${BASE_REF}" >/dev/null; then
  echo "openapi-diff-check.sh: base ref '${BASE_REF}' does not exist" >&2
  exit 2
fi

if ! git cat-file -e "${BASE_REF}:${SPEC_PATH_REL}" 2>/dev/null; then
  echo "openapi-diff-check.sh: ${SPEC_PATH_REL} does not exist at ${BASE_REF} -- nothing to diff" >&2
  echo "                       (this is expected for the PR that first introduces the spec)" >&2
  exit 0
fi

echo "==> Diffing ${SPEC_PATH_REL} : ${BASE_REF} -> working tree"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

BASE_SPEC="${WORKDIR}/base.yaml"
git show "${BASE_REF}:${SPEC_PATH_REL}" > "${BASE_SPEC}"
CURRENT_SPEC="${REPO_ROOT}/${SPEC_PATH_REL}"

# ---------------------------------------------------------------------------
# Pick a diff engine
# ---------------------------------------------------------------------------
run_oasdiff() {
  local bin_cmd=("$@")
  local exit_code=0

  if [[ "${SHOW_CHANGELOG}" -eq 1 ]]; then
    echo "--- changelog (${BASE_REF} -> working tree) ---"
    "${bin_cmd[@]}" changelog "${BASE_SPEC}" "${CURRENT_SPEC}" || true
    echo "---"
  fi

  echo "--- breaking-changes check ---"
  if ! "${bin_cmd[@]}" breaking "${BASE_SPEC}" "${CURRENT_SPEC}"; then
    exit_code=1
  fi
  return "${exit_code}"
}

if command -v oasdiff >/dev/null 2>&1; then
  echo "==> Using local oasdiff binary"
  if run_oasdiff oasdiff; then
    echo "openapi-diff-check.sh: no breaking changes."
    exit 0
  else
    echo "openapi-diff-check.sh: BREAKING CHANGES DETECTED (see above)." >&2
    exit 1
  fi
elif command -v docker >/dev/null 2>&1; then
  echo "==> No local oasdiff binary found; falling back to Docker (${OASDIFF_IMAGE})"
  echo "    (install a local binary for faster feedback: https://github.com/oasdiff/oasdiff#installation)"
  # oasdiff takes file paths, so both specs need to be inside the volume we
  # mount into the container -- base.yaml already is (WORKDIR), current.yaml
  # gets copied alongside it just for this invocation.
  run_oasdiff_docker() {
    local exit_code=0
    if [[ "${SHOW_CHANGELOG}" -eq 1 ]]; then
      echo "--- changelog (${BASE_REF} -> working tree) ---"
      docker run --rm -v "${WORKDIR}:/specs" "${OASDIFF_IMAGE}" changelog /specs/base.yaml /specs/current.yaml || true
      echo "---"
    fi
    echo "--- breaking-changes check ---"
    cp "${CURRENT_SPEC}" "${WORKDIR}/current.yaml"
    if ! docker run --rm -v "${WORKDIR}:/specs" "${OASDIFF_IMAGE}" breaking /specs/base.yaml /specs/current.yaml; then
      exit_code=1
    fi
    return "${exit_code}"
  }
  if run_oasdiff_docker; then
    echo "openapi-diff-check.sh: no breaking changes."
    exit 0
  else
    echo "openapi-diff-check.sh: BREAKING CHANGES DETECTED (see above)." >&2
    exit 1
  fi
else
  cat >&2 <<EOF
openapi-diff-check.sh: WARNING -- neither a local 'oasdiff' binary nor
'docker' is available, so this check cannot actually classify the diff as
breaking or non-breaking. Falling back to a plain textual diff for visibility
only. This means the CI gate is NOT enforcing anything right now -- install
oasdiff (https://github.com/oasdiff/oasdiff) or docker to restore real
contract-breakage detection.
EOF
  diff -u "${BASE_SPEC}" "${CURRENT_SPEC}" || true
  exit 0
fi
