#!/bin/bash
set -euo pipefail

fail() { echo "iOS release preflight: $*" >&2; exit 2; }
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"
: "${MARKETING_VERSION:?Set MARKETING_VERSION (for example 1.2.3)}"
: "${BUILD_NUMBER:?Set BUILD_NUMBER to a unique Apple-valid number (for example 123.1)}"
: "${ARCHIVE_PATH:=$RUNNER_TEMP/Playarr.xcarchive}"
: "${EXPORT_PATH:=$RUNNER_TEMP/ios-export}"
[[ "$BUILD_NUMBER" =~ ^[1-9][0-9]{0,3}(\.[1-9][0-9]?)?$ ]] || fail "BUILD_NUMBER must use Apple-valid numeric components (1-9999, optional .1-.99)"
[[ "$MARKETING_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "MARKETING_VERSION must be a numeric three-part version"
mode="${1:-archive}"
platform="${2:-ios}"
[[ "$mode" == archive || "$mode" == export || "$mode" == testflight ]] || fail "usage: release.sh archive|export|testflight [ios|tvos]"
[[ "$platform" == ios || "$platform" == tvos ]] || fail "platform must be ios or tvos"
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "$platform" == ios ]]; then
  project_path="$project_dir/Playarr.xcworkspace"
  project_flag=(-workspace)
  scheme="PlayarrApp"
  bundle_id="app.playarr.ios"
  profile_secret="APPLE_PROVISIONING_PROFILE_BASE64"
  upload_type="ios"
  destination_platform="iOS"
else
  project_path="$project_dir/../apple-tv/PlayarrTV.xcodeproj"
  project_flag=(-project)
  scheme="PlayarrTV"
  bundle_id="app.playarr.ios"
  profile_secret="APPLE_TVOS_PROVISIONING_PROFILE_BASE64"
  upload_type="appletvos"
  destination_platform="tvOS"
fi
[[ -d "$project_path" ]] || fail "${platform} project/workspace is missing; run prepare.sh first"

if [[ "$mode" == archive || "$mode" == export || "$mode" == testflight ]]; then
  : "${APPLE_DISTRIBUTION_P12_BASE64:?Missing APPLE_DISTRIBUTION_P12_BASE64}"
  : "${APPLE_DISTRIBUTION_P12_PASSWORD:?Missing APPLE_DISTRIBUTION_P12_PASSWORD}"
  profile_base64="${!profile_secret:-}"
  [[ -n "$profile_base64" ]] || fail "Missing $profile_secret"
  : "${APPLE_TEAM_ID:?Missing APPLE_TEAM_ID}"
  [[ "${RUNNER_ENVIRONMENT:-}" == self-hosted ]] || fail "signing/upload require the private authorised Apple runner"
  if [[ "$mode" == testflight ]]; then
    : "${APP_STORE_CONNECT_API_KEY_ID:?Missing APP_STORE_CONNECT_API_KEY_ID}"
    : "${APP_STORE_CONNECT_ISSUER_ID:?Missing APP_STORE_CONNECT_ISSUER_ID}"
    : "${APP_STORE_CONNECT_API_KEY_BASE64:?Missing APP_STORE_CONNECT_API_KEY_BASE64}"
  fi

  umask 077
  work="$RUNNER_TEMP/playarr-signing-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
  library_dir="$HOME/Library"
  developer_dir="$library_dir/Developer"
  xcode_dir="$developer_dir/Xcode"
  user_data_dir="$xcode_dir/UserData"
  profile_dir="$user_data_dir/Provisioning Profiles"
  library_dir_created="false"
  developer_dir_created="false"
  xcode_dir_created="false"
  user_data_dir_created="false"
  profile_dir_created="false"
  profile_backup=""
  profile_installed=""
  keychain="$work/playarr-signing.keychain-db"
  cleanup() {
    security delete-keychain "$keychain" >/dev/null 2>&1 || true
    if [[ -n "$profile_installed" ]]; then rm -f "$profile_installed"; fi
    if [[ -n "$profile_backup" && -n "$profile_installed" ]]; then mv "$profile_backup" "$profile_installed"; fi
    if [[ "$profile_dir_created" == true ]]; then rmdir "$profile_dir" 2>/dev/null || true; fi
    if [[ "$user_data_dir_created" == true ]]; then rmdir "$user_data_dir" 2>/dev/null || true; fi
    if [[ "$xcode_dir_created" == true ]]; then rmdir "$xcode_dir" 2>/dev/null || true; fi
    if [[ "$developer_dir_created" == true ]]; then rmdir "$developer_dir" 2>/dev/null || true; fi
    if [[ "$library_dir_created" == true ]]; then rmdir "$library_dir" 2>/dev/null || true; fi
    rm -rf "$work"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  mkdir -p "$work/private_keys"
  keychain_password="$(openssl rand -hex 24)"
  if [[ ! -d "$library_dir" ]]; then mkdir "$library_dir"; library_dir_created="true"; fi
  if [[ ! -d "$developer_dir" ]]; then mkdir "$developer_dir"; developer_dir_created="true"; fi
  if [[ ! -d "$xcode_dir" ]]; then mkdir "$xcode_dir"; xcode_dir_created="true"; fi
  if [[ ! -d "$user_data_dir" ]]; then mkdir "$user_data_dir"; user_data_dir_created="true"; fi
  if [[ ! -d "$profile_dir" ]]; then mkdir "$profile_dir"; profile_dir_created="true"; fi
  security create-keychain -p "$keychain_password" "$keychain"
  security set-keychain-settings -lut 21600 "$keychain"
  security unlock-keychain -p "$keychain_password" "$keychain"
  printf '%s' "$APPLE_DISTRIBUTION_P12_BASE64" | base64 -D > "$work/distribution.p12"
  security import "$work/distribution.p12" -k "$keychain" -P "$APPLE_DISTRIBUTION_P12_PASSWORD" -T /usr/bin/codesign >/dev/null
  security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" >/dev/null
  printf '%s' "$profile_base64" | base64 -D > "$work/profile.mobileprovision"
  security cms -D -i "$work/profile.mobileprovision" > "$work/profile.plist"
  profile_application_id="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$work/profile.plist")"
  profile_team="$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "$work/profile.plist")"
  [[ "$profile_application_id" == "$APPLE_TEAM_ID.$bundle_id" ]] || fail "provisioning profile bundle identifier must be $bundle_id for APPLE_TEAM_ID"
  [[ "$profile_team" == "$APPLE_TEAM_ID" ]] || fail "provisioning profile team does not match APPLE_TEAM_ID"
  python3 - "$work/profile.plist" <<'PY'
import datetime, plistlib, sys
with open(sys.argv[1], "rb") as source:
    profile = plistlib.load(source)
expiry = profile.get("ExpirationDate")
if not isinstance(expiry, datetime.datetime):
    raise SystemExit("iOS release preflight: provisioning profile is expired or has no valid expiry")
if expiry.tzinfo is None:
    expiry = expiry.replace(tzinfo=datetime.timezone.utc)
if expiry <= datetime.datetime.now(datetime.timezone.utc):
    raise SystemExit("iOS release preflight: provisioning profile is expired or has no valid expiry")
PY
  imported_identities="$(security find-identity -v -p codesigning "$keychain")"
  profile_certificate_match="false"
  python3 - "$work/profile.plist" "$work/profile-certificates" <<'PY'
import os, plistlib, sys
with open(sys.argv[1], "rb") as source:
    profile = plistlib.load(source)
os.makedirs(sys.argv[2], mode=0o700, exist_ok=True)
for index, certificate in enumerate(profile.get("DeveloperCertificates", [])):
    with open(os.path.join(sys.argv[2], f"{index}.der"), "wb") as output:
        output.write(certificate)
PY
  for certificate in "$work"/profile-certificates/*.der; do
    [[ -f "$certificate" ]] || continue
    fingerprint="$(openssl x509 -inform DER -in "$certificate" -noout -fingerprint -sha1 | sed 's/.*=//; s/://g' | tr '[:lower:]' '[:upper:]')"
    identity_line="$(grep -F "$fingerprint" <<<"$imported_identities" || true)"
    if [[ -n "$identity_line" ]]; then
      signing_identity="$(sed -E 's/^[[:space:]]*[0-9]+\) [A-Fa-f0-9]+ "([^"]+)".*/\1/' <<<"$identity_line")"
      profile_certificate_match="true"
      break
    fi
  done
  [[ "$profile_certificate_match" == true ]] || fail "provisioning profile developer certificate does not match the imported distribution certificate"
  profile_uuid="$(/usr/libexec/PlistBuddy -c 'Print UUID' "$work/profile.plist")"
  profile_target="$profile_dir/$profile_uuid.mobileprovision"
  if [[ -e "$profile_target" ]]; then
    profile_backup="$work/original-$profile_uuid.mobileprovision"
    cp -p "$profile_target" "$profile_backup"
  fi
  profile_installed="$profile_target"
  cp "$work/profile.mobileprovision" "$profile_installed"
  if [[ "$mode" == testflight ]]; then
    printf '%s' "$APP_STORE_CONNECT_API_KEY_BASE64" | base64 -D > "$work/private_keys/AuthKey_${APP_STORE_CONNECT_API_KEY_ID}.p8"
  fi
  signing_args=(CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="$signing_identity" DEVELOPMENT_TEAM="$APPLE_TEAM_ID" PROVISIONING_PROFILE_SPECIFIER="$profile_uuid" CODE_SIGN_KEYCHAIN="$keychain" OTHER_CODE_SIGN_FLAGS="--keychain $keychain")
  archive_signing_args=("${signing_args[@]}")
fi

xcodebuild "${project_flag[@]}" "$project_path" -scheme "$scheme" -configuration Release \
  -destination "generic/platform=$destination_platform" -archivePath "$ARCHIVE_PATH" \
  MARKETING_VERSION="$MARKETING_VERSION" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  "${archive_signing_args[@]}" archive
[[ "$mode" == archive ]] && exit 0

cat > "$work/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>export</string>
<key>signingStyle</key><string>manual</string>
<key>provisioningProfiles</key><dict><key>$bundle_id</key><string>$profile_uuid</string></dict>
<key>teamID</key><string>$APPLE_TEAM_ID</string>
<key>uploadSymbols</key><true/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$ARCHIVE_PATH" -exportPath "$EXPORT_PATH" -exportOptionsPlist "$work/ExportOptions.plist"
[[ "$mode" == export ]] && exit 0
ipa="$(find "$EXPORT_PATH" -maxdepth 1 -name '*.ipa' -print -quit)"
[[ -n "$ipa" ]] || fail "xcodebuild export produced no IPA"
(cd "$work" && xcrun altool --upload-app --type "$upload_type" --file "$ipa" --apiKey "$APP_STORE_CONNECT_API_KEY_ID" --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID")
