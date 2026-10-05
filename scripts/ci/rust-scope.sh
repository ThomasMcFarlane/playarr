#!/usr/bin/env bash
# Decide how much of the Rust workspace CI must check for a change.
#
# Prints key=value lines (for $GITHUB_OUTPUT):
#   rust_scope=none | full | "-p crate-a -p crate-b"   (changed crates plus every dependent)
#   openapi=true|false                                    (OpenAPI contract diff needed)
#
# Everything that every crate depends on (workspace manifest, lockfile, toolchain, deny config,
# the CI workflow and this script) selects `full`, as does any event that is not a pull request
# (pushes to main and the nightly schedule always run the full suite).
#
# Inputs: CHANGED_FILES (newline list, for tests) or EVENT_NAME/BASE_REF to diff against origin.
set -euo pipefail
cd "$(dirname "$0")/../.."

full() { echo "rust_scope=full"; echo "openapi=true"; exit 0; }

if [ -z "${CHANGED_FILES:-}" ]; then
  case "${EVENT_NAME:-}" in
    pull_request | workflow_dispatch) ;;
    *) full ;;
  esac
  base="${BASE_REF:-main}"
  git fetch -q --no-tags origin "$base" 2>/dev/null || full
  head=$(git rev-parse HEAD^2 2>/dev/null || git rev-parse HEAD)
  CHANGED_FILES=$(git diff --name-only "origin/$base...$head") || full
fi

# Direct (workspace-internal) dependencies of every package: "<pkg> <dep>" per line.
edges=$(
  for m in backend/Cargo.toml backend/crates/*/Cargo.toml; do
    if [ "$m" = backend/Cargo.toml ]; then pkg=playarr-bin; else pkg=$(basename "$(dirname "$m")"); fi
    awk -v pkg="$pkg" '
      /^\[/ { dep = ($0 ~ /dependencies\]$/ && $0 !~ /^\[workspace\./) }
      dep && /^playarr-[a-z0-9-]+/ { match($0, /^playarr-[a-z0-9-]+/); print pkg, substr($0, RSTART, RLENGTH) }
    ' "$m"
  done
)

seeds=""
openapi=false
any_rust=false
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    backend/crates/*/*) c=${f#backend/crates/}; seeds="$seeds ${c%%/*}"; any_rust=true ;;
    backend/migrations/*) seeds="$seeds playarr-db"; any_rust=true ;;
    backend/src/* | backend/tests/* | backend/config/*) seeds="$seeds playarr-bin"; any_rust=true ;;
    backend/openapi/*) seeds="$seeds playarr-api"; openapi=true; any_rust=true ;;
    backend/* | rust-toolchain.toml | .github/workflows/ci.yml | scripts/ci/* | scripts/openapi-diff-check.sh) full ;;
  esac
done <<<"$CHANGED_FILES"

if [ "$any_rust" = false ]; then
  echo "rust_scope=none"; echo "openapi=false"; exit 0
fi

# Reverse-dependency closure: anything that depends on a changed crate is affected.
set=" $seeds "
changed=1
while [ "$changed" = 1 ]; do
  changed=0
  while read -r pkg dep; do
    [ -z "$pkg" ] && continue
    case "$set" in *" $dep "*) case "$set" in *" $pkg "*) ;; *) set="$set$pkg "; changed=1 ;; esac ;; esac
  done <<<"$edges"
done

case "$set" in *" playarr-api "*) openapi=true ;; esac
args=""
for p in $(tr ' ' '\n' <<<"$set" | sort -u); do args="$args -p $p"; done
echo "rust_scope=${args# }"
echo "openapi=$openapi"
