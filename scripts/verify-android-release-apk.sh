#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 7 ]]; then
  echo "usage: $0 <apk> <apksigner> <aapt> <certificate-sha256> <package> <version-name> <version-code>" >&2
  exit 2
fi

apk="$1"
apksigner="$2"
aapt="$3"
expected_certificate_sha256="$(printf '%s' "$4" | tr '[:upper:]' '[:lower:]' | tr -d ':[:space:]')"
expected_package="$5"
expected_version_name="$6"
expected_version_code="$7"

if [[ ! -f "$apk" ]]; then
  echo "Android release APK is missing: $apk" >&2
  exit 1
fi
if [[ ! -x "$apksigner" || ! -x "$aapt" ]]; then
  echo "Android build tools are missing or not executable" >&2
  exit 1
fi
if [[ ! "$expected_certificate_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "ANDROID_SIGNING_CERT_SHA256 must contain one SHA-256 certificate fingerprint" >&2
  exit 1
fi

verification="$("$apksigner" verify --verbose --print-certs "$apk")"
printf '%s\n' "$verification"

signer_count="$(sed -n 's/^Number of signers: //p' <<< "$verification")"
signer_dn="$(sed -n 's/^Signer #1 certificate DN: //p' <<< "$verification")"
actual_certificate_sha256="$(
  sed -n 's/^Signer #1 certificate SHA-256 digest: //p' <<< "$verification" |
    tr '[:upper:]' '[:lower:]' |
    tr -d ':[:space:]'
)"

if [[ "$signer_count" != "1" ]]; then
  echo "Android release APK must have exactly one signer" >&2
  exit 1
fi
if [[ "${signer_dn,,}" == *"cn=android debug"* ]]; then
  echo "Android release APK is signed with the Android debug certificate" >&2
  exit 1
fi
if [[ "$actual_certificate_sha256" != "$expected_certificate_sha256" ]]; then
  echo "Android release certificate does not match ANDROID_SIGNING_CERT_SHA256" >&2
  exit 1
fi

package_line="$("$aapt" dump badging "$apk" | sed -n '1p')"
expected_prefix="package: name='$expected_package' versionCode='$expected_version_code' versionName='$expected_version_name'"
if [[ "$package_line" != "$expected_prefix"* ]]; then
  echo "Android release package or version metadata does not match the release tag" >&2
  echo "Expected: $expected_prefix" >&2
  echo "Actual:   $package_line" >&2
  exit 1
fi
