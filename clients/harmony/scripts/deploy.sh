#!/usr/bin/env bash
set -euo pipefail

# deploy.sh [path-to.hap]: sideload the built HAP onto a connected
# HarmonyOS device over hdc and launch it.
#
# Prefers the signed HAP from sign.sh; falls back to the unsigned HAP from
# build.sh for local testing on a device that allows unsigned installs.
#
# Requires HDC_TARGET to name the device. Find one with:
#   hdc list targets
#
# Brief reference: implementation brief §7.4, §10 R1.
#
# R1: nothing behavioural (this deploy included) can be exercised without
# real HarmonyOS hardware; see brief §10 R1 for the acceptance caveat this
# implies for Slices 4-7.

if [ -z "${HDC_TARGET:-}" ]; then
    echo "ERROR: HDC_TARGET is not set." >&2
    echo "Find a connected device's serial with: hdc list targets" >&2
    echo "Then rerun as: HDC_TARGET=<serial> bash scripts/deploy.sh" >&2
    exit 1
fi

if ! command -v hdc >/dev/null 2>&1; then
    echo "ERROR: hdc not found on PATH." >&2
    echo "hdc ships in the OpenHarmony SDK's toolchains; run 'bash scripts/fetch-sdk.sh' and source its env.sh first." >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_ROOT/entry/build/default/outputs/default"

BUNDLE_NAME="io.playarr.harmony"
ABILITY_NAME="EntryAbility"

if [ "${1:-}" != "" ]; then
    LOCAL_HAP="$1"
elif [ -f "$OUTPUT_DIR/entry-default-signed.hap" ]; then
    LOCAL_HAP="$OUTPUT_DIR/entry-default-signed.hap"
elif [ -f "$OUTPUT_DIR/entry-default-unsigned.hap" ]; then
    LOCAL_HAP="$OUTPUT_DIR/entry-default-unsigned.hap"
    echo "WARNING: no signed HAP found, deploying the unsigned build for local testing only." >&2
else
    echo "ERROR: no HAP found in $OUTPUT_DIR." >&2
    echo "Run 'bash scripts/build.sh' (and optionally 'bash scripts/sign.sh') first, or pass a path explicitly." >&2
    exit 1
fi

if [ ! -f "$LOCAL_HAP" ]; then
    echo "ERROR: HAP not found at $LOCAL_HAP" >&2
    exit 1
fi

DEVICE_PATH="/data/local/tmp/$(basename "$LOCAL_HAP")"

echo "==> Target device: $HDC_TARGET" >&2
echo "==> Sending $LOCAL_HAP -> $DEVICE_PATH" >&2
hdc -t "$HDC_TARGET" file send "$LOCAL_HAP" "$DEVICE_PATH"

echo "==> Installing $DEVICE_PATH" >&2
hdc -t "$HDC_TARGET" shell bm install -p "$DEVICE_PATH"

echo "==> Launching $BUNDLE_NAME/$ABILITY_NAME" >&2
hdc -t "$HDC_TARGET" shell aa start -a "$ABILITY_NAME" -b "$BUNDLE_NAME"

echo "==> Done. Tail logs with: hdc -t $HDC_TARGET shell hilog" >&2
