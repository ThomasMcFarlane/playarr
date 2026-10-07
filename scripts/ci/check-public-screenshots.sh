#!/usr/bin/env bash
# Owner rule: README, site and store-listing screenshots show the open-movie demo library and are produced by
# scripts/showcase, never by hand and never from the parity fixture. Two checks:
#   1. every public screenshot must match scripts/showcase/screenshots.sha256 (rewritten only by the capture scripts);
#   2. in a PR, a change to any public screenshot must also touch scripts/showcase/.
# Env: BASE_REF (PR base branch, default main); with no base available only check 1 runs.
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/showcase/manifest.mjs --check

base="${BASE_REF:-main}"
if [[ "${GITHUB_EVENT_NAME:-pull_request}" == "pull_request" ]] && git rev-parse --verify -q "origin/${base}" >/dev/null; then
  changed="$(git diff --name-only "origin/${base}...HEAD")"
  shots="$(grep -E '^(docs/assets/readme/screenshots/|site/src/assets/screenshots/|site/public/screenshots/|clients/android/fastlane/metadata/android/[^/]+/images/(phone|sevenInch|tenInch|tv|wear)Screenshots/|clients/ios/fastlane/screenshots/|clients/apple-tv/fastlane/screenshots/)' <<<"${changed}" || true)"
  if [[ -n "${shots}" ]] && ! grep -q '^scripts/showcase/' <<<"${changed}"; then
    echo "Public screenshots changed without touching scripts/showcase/:" >&2
    sed 's/^/  /' <<<"${shots}" >&2
    echo "Retake them with scripts/showcase (open-movie demo library) so the capture script and manifest change with them." >&2
    exit 1
  fi
fi
echo "public screenshot guard ok"
