#!/usr/bin/env bash
set -euo pipefail

# fetch-sdk.sh: download and unpack the OpenHarmony public SDK and the
# Huawei Command Line Tools into a local cache, then emit the environment
# a build needs to find them.
#
# Usage:
#   bash scripts/fetch-sdk.sh
#   source <(bash scripts/fetch-sdk.sh)   # to pull the exports into the
#                                          # current shell instead of a
#                                          # later script sourcing env.sh
#
# Requires: curl or wget, tar, unzip, and (for the build step that follows
# this one) Node 18 and JDK 17 on PATH. This script does not install those.
#
# Brief reference: implementation brief §7.3 "Tier 1", §10 R4/R5.
#
# Caveats carried over from the brief (§10):
#   R5: the public SDK URL below is pinned to 6.1-Release (API 24-era)
#        while the app targets compatibleSdkVersion 5.0.0(12). That is
#        what compatibleSdkVersion is for, but it is UNVERIFIED from this
#        offline environment. If `assembleHap` in build.sh fails against
#        that combination, re-pin OHOS_SDK_URL below to a 5.0-era tarball
#        and update this comment with the working URL.
#   R4: no hvigorw wrapper script is vendored into this repo. hvigorw
#        ships inside the Command Line Tools archive fetched here; build.sh
#        calls that binary directly via PATH rather than a committed
#        wrapper (see build.sh for the reasoning).
#
# The exact internal layout of both archives (which subdirectories are
# already-unpacked trees vs. nested per-component zips) is also unverified
# offline. The unpack step below handles both shapes defensively: it
# recurses into the archive, and if it finds nested .zip files it unzips
# those in turn. If Huawei changes the packaging shape, this is the first
# place to look.

OHOS_SDK_URL="https://repo.huaweicloud.com/harmonyos/os/6.1-Release/ohos-sdk-windows_linux-public.tar.gz"
CLI_TOOLS_URL="https://repo.huaweicloud.com/harmonyos/ohpm/5.1.0/commandline-tools-linux-x64-5.1.0.840.zip"

OHOS_SDK_CACHE="${OHOS_SDK_CACHE:-$HOME/.cache/ohos-sdk}"
SDK_HOME="$OHOS_SDK_CACHE/sdk"
CLI_HOME="$OHOS_SDK_CACHE/command-line-tools"
DOWNLOAD_DIR="$OHOS_SDK_CACHE/downloads"
ENV_FILE="$OHOS_SDK_CACHE/env.sh"

log() {
    # Progress/status output goes to stderr so that this script's stdout
    # can be sourced directly (`source <(bash scripts/fetch-sdk.sh)`)
    # without a human-readable line breaking the shell parser.
    echo "==> $*" >&2
}

warn() {
    echo "WARNING: $*" >&2
}

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "ERROR: required command '$1' not found on PATH." >&2
        exit 1
    fi
}

# Temp staging dirs are tracked here and removed by a single top-level EXIT
# trap. (A per-function `trap ... RETURN` does NOT fire when set -e aborts
# the function on a failing command, so cleanup has to live at this level
# to be reliable on the error path too.)
_TMP_STAGE_DIRS=()
_cleanup_stage_dirs() {
    local d
    for d in "${_TMP_STAGE_DIRS[@]:-}"; do
        if [ -n "$d" ]; then rm -rf "$d"; fi
    done
    # Newer bash makes an EXIT trap's last status the script's exit status.
    return 0
}
trap _cleanup_stage_dirs EXIT

new_stage_dir() {
    local d
    d="$(mktemp -d)"
    _TMP_STAGE_DIRS+=("$d")
    echo "$d"
}

download() {
    # download <url> <dest-file>
    local url="$1" dest="$2"
    if [ -f "$dest" ]; then
        log "Already downloaded: $dest"
        return 0
    fi
    mkdir -p "$(dirname "$dest")"
    log "Downloading $url"
    if command -v curl >/dev/null 2>&1; then
        curl -fL --retry 3 --retry-delay 2 -o "$dest.part" "$url"
    elif command -v wget >/dev/null 2>&1; then
        wget -O "$dest.part" "$url"
    else
        echo "ERROR: neither curl nor wget is available to download $url" >&2
        exit 1
    fi
    mv "$dest.part" "$dest"
}

# unzip_nested <dir>: unzip any *.zip files found directly inside <dir>
# into <dir> itself, then remove the zip. Huawei's public SDK archive
# ships component archives (native, ets, js, previewer, toolchains, ...)
# as nested zips under linux/; this flattens them into one tree. Safe to
# call on a directory with no nested zips (a no-op).
unzip_nested() {
    local dir="$1"
    find "$dir" -maxdepth 1 -type f -name '*.zip' -print0 | while IFS= read -r -d '' zipfile; do
        log "Unpacking nested archive: $(basename "$zipfile")"
        unzip -q -o "$zipfile" -d "$dir"
        rm -f "$zipfile"
    done
}

sdk_populated() {
    [ -d "$SDK_HOME/toolchains" ]
}

cli_populated() {
    [ -x "$CLI_HOME/ohpm/bin/ohpm" ] || [ -f "$CLI_HOME/ohpm/bin/ohpm" ]
}

fetch_sdk() {
    if sdk_populated; then
        log "SDK cache already populated at $SDK_HOME: skipping download."
        return 0
    fi

    require_cmd tar

    local tarball="$DOWNLOAD_DIR/ohos-sdk-windows_linux-public.tar.gz"
    download "$OHOS_SDK_URL" "$tarball"

    local stage
    stage="$(new_stage_dir)"

    log "Extracting linux/ subtree from $(basename "$tarball") (discarding windows/)"
    # Only extract the linux/ prefix: the windows/ half of this archive
    # is irrelevant on this platform and can be large.
    tar -xzf "$tarball" -C "$stage" linux/

    mkdir -p "$SDK_HOME"
    if [ -d "$stage/linux" ]; then
        # Merge whatever the tarball put under linux/ into SDK_HOME. This
        # may already be a full SDK tree, or a flat pile of per-component
        # zips: unzip_nested handles the latter.
        cp -a "$stage/linux/." "$SDK_HOME/"
    else
        echo "ERROR: expected a linux/ directory inside $tarball, found none." >&2
        exit 1
    fi

    unzip_nested "$SDK_HOME"
    # One more pass in case component zips themselves contained nested
    # zips (observed in some historical SDK releases).
    unzip_nested "$SDK_HOME"

    if ! sdk_populated; then
        warn "Unpacked SDK does not contain toolchains/ at $SDK_HOME as expected."
        warn "The archive layout may have changed: inspect $SDK_HOME by hand (see brief §10 R5)."
    fi
}

fetch_cli_tools() {
    if cli_populated; then
        log "Command Line Tools cache already populated at $CLI_HOME: skipping download."
        return 0
    fi

    require_cmd unzip

    local zipfile="$DOWNLOAD_DIR/commandline-tools-linux-x64-5.1.0.840.zip"
    download "$CLI_TOOLS_URL" "$zipfile"

    local stage
    stage="$(new_stage_dir)"

    log "Extracting Command Line Tools"
    unzip -q "$zipfile" -d "$stage"

    local src="$stage"
    if [ -d "$stage/command-line-tools" ]; then
        # The zip commonly wraps everything in a top-level
        # command-line-tools/ directory: unwrap it so CLI_HOME points
        # straight at bin/, ohpm/, hvigor/, sdk/, etc.
        src="$stage/command-line-tools"
    fi

    mkdir -p "$CLI_HOME"
    cp -a "$src/." "$CLI_HOME/"

    if ! cli_populated; then
        warn "Unpacked Command Line Tools do not contain ohpm/bin/ohpm at $CLI_HOME as expected."
        warn "The archive layout may have changed: inspect $CLI_HOME by hand (see brief §10 R4)."
    fi
}

write_env_file() {
    mkdir -p "$OHOS_SDK_CACHE"
    cat >"$ENV_FILE" <<EOF
#!/usr/bin/env bash
# Generated by fetch-sdk.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Do not edit
# by hand: rerun scripts/fetch-sdk.sh to regenerate. Sourced by build.sh
# and sign.sh.
# hvigor resolves the compile SDK from DEVECO_SDK_HOME/default/{openharmony,hms}. The Command
# Line Tools bundle exactly that layout (API 18, matching hvigor 5.18.5); the separately
# downloaded public SDK is flat (no default/ level) and has no HMS component, so hvigor
# reports "SDK component missing" when pointed at it. The public SDK stays available as
# OHOS_SDK_HOME for toolchains (hdc, signing).
export DEVECO_SDK_HOME="$CLI_HOME/sdk"
export OHOS_SDK_HOME="$SDK_HOME"
export OHOS_BASE_SDK_HOME="$SDK_HOME"
export HOS_SDK_HOME="$SDK_HOME"
export OHOS_CLI_HOME="$CLI_HOME"
export PATH="$CLI_HOME/ohpm/bin:$CLI_HOME/hvigor/bin:\$PATH"
export LD_LIBRARY_PATH="$SDK_HOME/toolchains/lib\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"
EOF
    chmod +x "$ENV_FILE"
}

main() {
    mkdir -p "$OHOS_SDK_CACHE" "$DOWNLOAD_DIR"

    fetch_sdk
    fetch_cli_tools
    write_env_file

    log "SDK home:        $SDK_HOME"
    log "CLI tools home:  $CLI_HOME"
    log "Env file:        $ENV_FILE"
    log ""
    log "Reminder: building also requires Node 18 and JDK 17 on PATH."
    log "  Node:  $(command -v node >/dev/null 2>&1 && node --version || echo 'NOT FOUND on PATH')"
    log "  Java:  $(command -v java >/dev/null 2>&1 && java -version 2>&1 | head -n1 || echo 'NOT FOUND on PATH')"
    log ""
    log "Next: bash scripts/build.sh [debug|release]"

    # The sourceable payload: printed last, and only this, to stdout.
    cat "$ENV_FILE"
}

main "$@"
