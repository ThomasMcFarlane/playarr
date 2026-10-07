# Shared settings for the showcase scripts. Source it; never run it.
# The showcase is the PUBLIC demo environment (README, site and store-listing screenshots). It is entirely
# separate from scripts/fixtures (the parity fixture), which must never be used for public images.
SC_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SC_REPO_ROOT="$(cd "${SC_SCRIPT_DIR}/../.." && pwd)"
SC_DIR="${PLAYARR_SHOWCASE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/playarr-showcase}"
SC_MEDIA="${PLAYARR_SHOWCASE_MEDIA:-${SC_DIR}/media}"
SC_BASE_PORT="${PLAYARR_SHOWCASE_PORT:-18810}"
SC_RADARR_PORT=$((SC_BASE_PORT + 1))
SC_SONARR_PORT=$((SC_BASE_PORT + 2))
SC_WEB_PORT=$((SC_BASE_PORT + 3))
SC_METRICS_PORT=$((SC_BASE_PORT + 4))
SC_URL="http://127.0.0.1:${SC_BASE_PORT}"
SC_RUN="${SC_DIR}/run"
SC_LOGS="${SC_DIR}/logs"
SC_DATA="${SC_DIR}/data"
SC_USER="demo"
SC_PASSWORD_FILE="${SC_RUN}/demo-password"
SC_ARR_KEY_FILE="${SC_RUN}/arr-key"

# Every ffmpeg/ffprobe call goes through this wrapper (memory scope, two threads).
sc_ffmpeg() {
  systemd-run --user --scope -q -p MemoryHigh=2G -p MemoryMax=3G -p MemorySwapMax=0 -- timeout "${SC_FFMPEG_TIMEOUT:-1800}" ffmpeg -threads 2 "$@"
}
sc_ffprobe() {
  systemd-run --user --scope -q -p MemoryHigh=2G -p MemoryMax=3G -p MemorySwapMax=0 -- timeout 120 ffprobe "$@"
}
