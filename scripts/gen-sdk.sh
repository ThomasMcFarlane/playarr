#!/usr/bin/env bash
#
# scripts/gen-sdk.sh
#
# Generates the Playarr Server client SDKs from backend/openapi/playarr.yaml,
# for each of the three non-Rust client platforms:
#
#   kotlin      -> clients/android/sdk       (Android mobile + TV)
#   swift5      -> clients/ios/PlayarrSDK          (iOS + tvOS)
#   typescript  -> clients/tv-web/packages/api-client/src/generated
#                  (Web, webOS, Tizen, VIDAA-fallback -- the pnpm workspace
#                  at clients/tv-web)
#
# Everything runs through Docker so nobody needs a local Java (for
# openapi-generator-cli) or, in the default TypeScript mode, even Node --
# `cargo run`/`pnpm install` are the only local toolchains this repo
# otherwise assumes.
#
# Usage:
#   ./scripts/gen-sdk.sh                       # generate all three targets
#   ./scripts/gen-sdk.sh kotlin swift            # generate a subset
#   ./scripts/gen-sdk.sh --ts-mode typescript-fetch typescript
#   ./scripts/gen-sdk.sh --input /path/to/spec.yaml
#   ./scripts/gen-sdk.sh --dry-run               # print commands, run nothing
#
# TypeScript has two modes (see clients/shared/sdk-codegen/typescript-config.yaml
# for the full rationale):
#   openapi-fetch     (default) openapi-typescript generates *types only*;
#                      the openapi-fetch runtime is a normal npm dependency.
#                      Matches what clients/tv-web/packages/api-client
#                      already documents itself as migrating to.
#   typescript-fetch   openapi-generator-cli's fully generated client, via
#                      the same Docker image used for kotlin/swift5.
#
# Env overrides:
#   OPENAPI_SPEC_PATH        default: backend/openapi/playarr.yaml
#   OPENAPI_GENERATOR_IMAGE  default: openapitools/openapi-generator-cli:v7.9.0
#   NODE_IMAGE               default: node:20-alpine (only used for the
#                              default TypeScript openapi-fetch mode)
#   KOTLIN_OUTPUT_DIR        default: clients/android/sdk
#   SWIFT_OUTPUT_DIR         default: clients/ios/PlayarrSDK
#   TS_OUTPUT_DIR             default (openapi-fetch mode):
#                              clients/tv-web/packages/api-client/src/generated
#                             default (typescript-fetch mode):
#                              clients/tv-web/packages/api-client-generated
#
# NOTE: this script is authored as scaffolding. backend/openapi/playarr.yaml
# does not exist yet (the backend hasn't landed its OpenAPI export step), so
# running this script today will fail fast at the spec-existence check below
# by design -- it is not executed as part of building this repo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

OPENAPI_SPEC_PATH="${OPENAPI_SPEC_PATH:-${REPO_ROOT}/backend/openapi/playarr.yaml}"
OPENAPI_GENERATOR_IMAGE="${OPENAPI_GENERATOR_IMAGE:-openapitools/openapi-generator-cli:v7.9.0}"
NODE_IMAGE="${NODE_IMAGE:-node:20-alpine}"

KOTLIN_CONFIG="${REPO_ROOT}/clients/shared/sdk-codegen/kotlin-config.yaml"
SWIFT_CONFIG="${REPO_ROOT}/clients/shared/sdk-codegen/swift-config.yaml"
TS_CONFIG="${REPO_ROOT}/clients/shared/sdk-codegen/typescript-config.yaml"

KOTLIN_OUTPUT_DIR="${KOTLIN_OUTPUT_DIR:-${REPO_ROOT}/clients/android/sdk}"
SWIFT_OUTPUT_DIR="${SWIFT_OUTPUT_DIR:-${REPO_ROOT}/clients/ios/PlayarrSDK}"

TS_MODE="openapi-fetch"
DRY_RUN=0
TARGETS=()

usage() {
  grep -E '^#( |$)' "${BASH_SOURCE[0]}" | sed -E 's/^# ?//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input)
      OPENAPI_SPEC_PATH="$2"
      shift 2
      ;;
    --ts-mode)
      TS_MODE="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage 0
      ;;
    kotlin|swift|typescript)
      TARGETS+=("$1")
      shift
      ;;
    *)
      echo "gen-sdk.sh: unknown argument: $1" >&2
      usage 1
      ;;
  esac
done

if [[ "${#TARGETS[@]}" -eq 0 ]]; then
  TARGETS=(kotlin swift typescript)
fi

if [[ "${TS_MODE}" != "openapi-fetch" && "${TS_MODE}" != "typescript-fetch" ]]; then
  echo "gen-sdk.sh: --ts-mode must be 'openapi-fetch' or 'typescript-fetch', got '${TS_MODE}'" >&2
  exit 1
fi

if [[ "${TS_MODE}" == "openapi-fetch" ]]; then
  TS_OUTPUT_DIR="${TS_OUTPUT_DIR:-${REPO_ROOT}/clients/tv-web/packages/api-client/src/generated}"
else
  TS_OUTPUT_DIR="${TS_OUTPUT_DIR:-${REPO_ROOT}/clients/tv-web/packages/api-client-generated}"
fi

run() {
  echo "+ $*"
  if [[ "${DRY_RUN}" -ne 1 ]]; then
    "$@"
  fi
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "gen-sdk.sh: required command '$1' not found on PATH" >&2
    exit 1
  fi
}

require_cmd docker

if [[ ! -f "${OPENAPI_SPEC_PATH}" ]]; then
  echo "gen-sdk.sh: OpenAPI spec not found: ${OPENAPI_SPEC_PATH}" >&2
  echo "            (expected backend/openapi/playarr.yaml -- generate/export it from the" >&2
  echo "            backend first, e.g. via its utoipa-driven OpenAPI export step)" >&2
  exit 1
fi

# Canonicalise to an absolute path so the "#${REPO_ROOT}/" prefix-strip used
# below to convert host paths -> /local/... container paths works regardless
# of whether --input/env vars were given relative or absolute paths.
OPENAPI_SPEC_PATH="$(cd "$(dirname "${OPENAPI_SPEC_PATH}")" && pwd)/$(basename "${OPENAPI_SPEC_PATH}")"

if [[ "${OPENAPI_SPEC_PATH}" != "${REPO_ROOT}"/* ]]; then
  echo "gen-sdk.sh: OpenAPI spec must live inside the repo (${REPO_ROOT}) since only the repo" >&2
  echo "            root is bind-mounted into the generator container. Got: ${OPENAPI_SPEC_PATH}" >&2
  exit 1
fi

# openapi-generator-cli validates the spec strictly by default; run it once
# up front so kotlin/swift5 failures point at the spec, not the generator
# invocation, when both are requested together.
validate_spec() {
  run docker run --rm \
    -v "${REPO_ROOT}:/local" \
    "${OPENAPI_GENERATOR_IMAGE}" validate \
    -i "/local/${OPENAPI_SPEC_PATH#"${REPO_ROOT}"/}"
}

gen_kotlin() {
  echo "==> Generating Kotlin SDK -> ${KOTLIN_OUTPUT_DIR}"
  run mkdir -p "${KOTLIN_OUTPUT_DIR}"
  run docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v "${REPO_ROOT}:/local" \
    "${OPENAPI_GENERATOR_IMAGE}" generate \
    -i "/local/${OPENAPI_SPEC_PATH#"${REPO_ROOT}"/}" \
    -g kotlin \
    -c "/local/${KOTLIN_CONFIG#"${REPO_ROOT}"/}" \
    -o "/local/${KOTLIN_OUTPUT_DIR#"${REPO_ROOT}"/}"
}

gen_swift() {
  echo "==> Generating Swift SDK -> ${SWIFT_OUTPUT_DIR}"
  run mkdir -p "${SWIFT_OUTPUT_DIR}"
  run docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v "${REPO_ROOT}:/local" \
    "${OPENAPI_GENERATOR_IMAGE}" generate \
    -i "/local/${OPENAPI_SPEC_PATH#"${REPO_ROOT}"/}" \
    -g swift5 \
    -c "/local/${SWIFT_CONFIG#"${REPO_ROOT}"/}" \
    -o "/local/${SWIFT_OUTPUT_DIR#"${REPO_ROOT}"/}"
}

gen_typescript_openapi_fetch() {
  echo "==> Generating TypeScript types (openapi-typescript) -> ${TS_OUTPUT_DIR}/schema.d.ts"
  run mkdir -p "${TS_OUTPUT_DIR}"
  # `npx -y` pulls openapi-typescript inside the throwaway node container on
  # each run rather than requiring it as a devDependency anywhere -- fine
  # for this scaffold; pin a version (openapi-typescript@7) once the
  # generation step is wired into CI so drift doesn't silently change output.
  run docker run --rm \
    -v "${REPO_ROOT}:/local" \
    -w /local \
    "${NODE_IMAGE}" \
    npx -y openapi-typescript@7 \
    "/local/${OPENAPI_SPEC_PATH#"${REPO_ROOT}"/}" \
    -o "/local/${TS_OUTPUT_DIR#"${REPO_ROOT}"/}/schema.d.ts"

  cat <<'EOF'
    NOTE: openapi-typescript only emits types (schema.d.ts). It does not add
    'openapi-fetch' as a runtime dependency -- if clients/tv-web/packages/api-client
    doesn't already depend on it, add it from within clients/tv-web:
      pnpm --filter @playarr-tv/api-client add openapi-fetch
    then point src/index.ts's ApiClient at
      import type { paths } from "./generated/schema";
      import createClient from "openapi-fetch";
      const client = createClient<paths>({ baseUrl });
    replacing (or wrapping) the hand-written fetch client currently there.
EOF
}

gen_typescript_generator() {
  echo "==> Generating TypeScript SDK (openapi-generator typescript-fetch) -> ${TS_OUTPUT_DIR}"
  run mkdir -p "${TS_OUTPUT_DIR}"
  run docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v "${REPO_ROOT}:/local" \
    "${OPENAPI_GENERATOR_IMAGE}" generate \
    -i "/local/${OPENAPI_SPEC_PATH#"${REPO_ROOT}"/}" \
    -g typescript-fetch \
    -c "/local/${TS_CONFIG#"${REPO_ROOT}"/}" \
    -o "/local/${TS_OUTPUT_DIR#"${REPO_ROOT}"/}"
}

needs_generator_image=0
for t in "${TARGETS[@]}"; do
  case "$t" in
    kotlin|swift) needs_generator_image=1 ;;
    typescript) [[ "${TS_MODE}" == "typescript-fetch" ]] && needs_generator_image=1 ;;
  esac
done
[[ "${needs_generator_image}" -eq 1 ]] && validate_spec

for target in "${TARGETS[@]}"; do
  case "${target}" in
    kotlin) gen_kotlin ;;
    swift) gen_swift ;;
    typescript)
      if [[ "${TS_MODE}" == "openapi-fetch" ]]; then
        gen_typescript_openapi_fetch
      else
        gen_typescript_generator
      fi
      ;;
  esac
done

echo "==> gen-sdk.sh done (targets: ${TARGETS[*]}, ts-mode: ${TS_MODE})"
