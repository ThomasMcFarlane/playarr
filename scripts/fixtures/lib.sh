# Shared settings for scripts/fixtures/*.sh. Source it; do not execute it.
FIX_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIX_REPO_ROOT="$(cd "${FIX_SCRIPT_DIR}/../.." && pwd)"

# Everything the environment writes lives under one directory (git-ignored).
FIX_DIR="${PLAYARR_FIXTURE_DIR:-${FIX_REPO_ROOT}/.fixtures}"
FIX_PORT="${PLAYARR_FIXTURE_PORT:-18484}"
# 127.0.0.1 is reachable from the Android emulator as 10.0.2.2. Use 0.0.0.0
# only to reach the server from a physical device on a trusted network.
FIX_BIND="${PLAYARR_FIXTURE_BIND:-127.0.0.1}"
FIX_STUB_PORT="${PLAYARR_FIXTURE_STUB_PORT:-18490}"
FIX_METRICS_PORT="${PLAYARR_FIXTURE_METRICS_PORT:-18491}"
FIX_URL="http://127.0.0.1:${FIX_PORT}"
# Fixture-only credentials: public on purpose, the server only holds placeholders.
FIX_STUB_KEY="fixture-stub-key"
FIX_JWT_SECRET="fixture-jwt-secret-not-for-production-0123456789"

FIX_MEDIA_DIR="${FIX_DIR}/media"
FIX_DATA_DIR="${FIX_DIR}/data"
FIX_LOG_DIR="${FIX_DIR}/logs"
FIX_RUN_DIR="${FIX_DIR}/run"
