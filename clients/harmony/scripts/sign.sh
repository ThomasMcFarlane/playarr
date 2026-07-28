#!/usr/bin/env bash
set -euo pipefail

# sign.sh [path-to-unsigned.hap]: sign the HAP produced by build.sh using
# Huawei's hap-sign-tool.jar (bundled in the Command Line Tools).
#
# All signing material comes from environment variables only: nothing is
# ever read from, or written into, the repo tree. Required:
#   HARMONY_SIGN_CERT_PATH              path to the app certificate (.cer)
#   HARMONY_SIGN_P7B_PATH               path to the provisioning profile (.p7b)
#   HARMONY_SIGN_KEYSTORE_PATH          path to the signing keystore (.p12/.jks)
#   HARMONY_SIGN_KEYSTORE_PASSWORD      keystore (and key) password
#   HARMONY_SIGN_ALIAS                  key alias inside the keystore
#
# Brief reference: implementation brief §7.3 step 5, §10 R9.
#
# R9: this material comes from AppGallery Connect, which is Huawei-account
# and enterprise-verification gated. This script only performs the local
# signing step once you already have that material; obtaining it is a
# separate, non-blocking track (see brief §10 R9). Slices 1-8 all produce
# and validate an UNSIGNED HAP without ever needing this script.
#
# The exact CLI surface of hap-sign-tool.jar has not been verified from
# this offline environment (no SDK, no jar, no device here). The
# `sign-app` subcommand and flag names below match Huawei's published
# hap-sign-tool documentation; run
#   java -jar "$HAP_SIGN_TOOL_JAR" sign-app -help
# to confirm the flag set the first time this is run for real, and adjust
# the invocation below if it disagrees.

for var in HARMONY_SIGN_CERT_PATH HARMONY_SIGN_P7B_PATH HARMONY_SIGN_KEYSTORE_PATH \
    HARMONY_SIGN_KEYSTORE_PASSWORD HARMONY_SIGN_ALIAS; do
    if [ -z "${!var:-}" ]; then
        echo "ERROR: required environment variable $var is not set." >&2
        echo "Signing material must come from the environment, never the repo. Required:" >&2
        echo "  HARMONY_SIGN_CERT_PATH, HARMONY_SIGN_P7B_PATH, HARMONY_SIGN_KEYSTORE_PATH," >&2
        echo "  HARMONY_SIGN_KEYSTORE_PASSWORD, HARMONY_SIGN_ALIAS" >&2
        exit 1
    fi
done

for f in "$HARMONY_SIGN_CERT_PATH" "$HARMONY_SIGN_P7B_PATH" "$HARMONY_SIGN_KEYSTORE_PATH"; do
    if [ ! -f "$f" ]; then
        echo "ERROR: signing material not found at: $f" >&2
        exit 1
    fi
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

OHOS_SDK_CACHE="${OHOS_SDK_CACHE:-$HOME/.cache/ohos-sdk}"
ENV_FILE="$OHOS_SDK_CACHE/env.sh"

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: $ENV_FILE not found." >&2
    echo "Run 'bash scripts/fetch-sdk.sh' first to download the Command Line Tools." >&2
    exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [ -z "${OHOS_CLI_HOME:-}" ] || [ ! -d "$OHOS_CLI_HOME" ]; then
    echo "ERROR: OHOS_CLI_HOME is not set or does not exist (got '${OHOS_CLI_HOME:-}')." >&2
    echo "Rerun 'bash scripts/fetch-sdk.sh'." >&2
    exit 1
fi

if ! command -v java >/dev/null 2>&1; then
    echo "ERROR: java (JDK 17) not found on PATH: required to run hap-sign-tool.jar." >&2
    exit 1
fi

HAP_SIGN_TOOL_JAR="$(find "$OHOS_CLI_HOME" -type f -name 'hap-sign-tool.jar' 2>/dev/null | head -n1)"
if [ -z "$HAP_SIGN_TOOL_JAR" ]; then
    echo "ERROR: hap-sign-tool.jar not found anywhere under $OHOS_CLI_HOME." >&2
    echo "The Command Line Tools archive layout may not match what this script expects." >&2
    exit 1
fi

UNSIGNED_HAP="${1:-$PROJECT_ROOT/entry/build/default/outputs/default/entry-default-unsigned.hap}"
if [ ! -f "$UNSIGNED_HAP" ]; then
    echo "ERROR: unsigned HAP not found at $UNSIGNED_HAP." >&2
    echo "Run 'bash scripts/build.sh' first, or pass the path explicitly." >&2
    exit 1
fi

case "$UNSIGNED_HAP" in
    *-unsigned.hap) SIGNED_HAP="${UNSIGNED_HAP%-unsigned.hap}-signed.hap" ;;
    *.hap) SIGNED_HAP="${UNSIGNED_HAP%.hap}-signed.hap" ;;
    *)
        echo "ERROR: expected a .hap file, got: $UNSIGNED_HAP" >&2
        exit 1
        ;;
esac

TMP_SIGN_DIR="$(mktemp -d)"
cleanup() {
    # Signing material is copied into a temp dir purely because
    # hap-sign-tool.jar is happiest reading local files with predictable
    # names; it is never written into the repo tree, and this trap wipes
    # the temp copy unconditionally, success or failure.
    rm -rf "$TMP_SIGN_DIR"
}
trap cleanup EXIT

CERT_COPY="$TMP_SIGN_DIR/app.cer"
P7B_COPY="$TMP_SIGN_DIR/profile.p7b"
KEYSTORE_COPY="$TMP_SIGN_DIR/keystore$(printf '%s' "$HARMONY_SIGN_KEYSTORE_PATH" | grep -o '\.[A-Za-z0-9]*$' || true)"

cp "$HARMONY_SIGN_CERT_PATH" "$CERT_COPY"
cp "$HARMONY_SIGN_P7B_PATH" "$P7B_COPY"
cp "$HARMONY_SIGN_KEYSTORE_PATH" "$KEYSTORE_COPY"

echo "==> Signing $(basename "$UNSIGNED_HAP")" >&2
java -jar "$HAP_SIGN_TOOL_JAR" sign-app \
    -mode localSign \
    -signAlg SHA256withECDSA \
    -keystoreFile "$KEYSTORE_COPY" \
    -keystorePwd "$HARMONY_SIGN_KEYSTORE_PASSWORD" \
    -keyAlias "$HARMONY_SIGN_ALIAS" \
    -keyPwd "$HARMONY_SIGN_KEYSTORE_PASSWORD" \
    -appCertFile "$CERT_COPY" \
    -profileFile "$P7B_COPY" \
    -profileSigned 1 \
    -inFile "$UNSIGNED_HAP" \
    -outFile "$SIGNED_HAP"

echo "==> Signed HAP written to: $SIGNED_HAP" >&2
