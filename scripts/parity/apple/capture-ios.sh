#!/usr/bin/env bash
# Captures the iOS app on a booted simulator, one PNG per parity screen.
#   capture-ios.sh <udid> <bundle-id> <server-url> <out-dir> [screen ...]
# Env: PARITY_USER (default fx-viewer), PARITY_PASSWORD (required), PARITY_SETTLE (seconds, default 8)
set -euo pipefail
udid="$1"; bundle="$2"; server="$3"; out="$4"; shift 4
here="$(cd "$(dirname "$0")" && pwd)"
user="${PARITY_USER:-fx-viewer}"
settle="${PARITY_SETTLE:-8}"
mkdir -p "$out"
xcrun simctl status_bar "$udid" override --time 9:41 --batteryState charged --batteryLevel 100 \
  --cellularMode active --cellularBars 4 --wifiBars 3 || true
screens=("$@")
if [[ ${#screens[@]} -eq 0 ]]; then
  mapfile -t screens < <(node -e 'console.log(Object.keys(require(process.argv[1]).screens).join("\n"))' "$here/ios-screens.json")
fi
for id in "${screens[@]}"; do
  spec="$(node -e '
    const s=require(process.argv[1]).screens[process.argv[2]];
    if(!s){console.log("MISSING");process.exit()}
    const a=["--playarr-parity-screen",s.screen];
    if(s.title)a.push("--playarr-parity-title",s.title);
    if(s.query)a.push("--playarr-parity-query",s.query);
    if(s.user)a.push("--playarr-parity-user",s.user);
    console.log(a.join("\t"));' "$here/ios-screens.json" "$id")"
  xcrun simctl terminate "$udid" "$bundle" >/dev/null 2>&1 || true
  # A missing screen is captured as the home screen so the diff still reports it.
  if [[ "$spec" == MISSING ]]; then spec=$'--playarr-parity-screen\thome'; echo "note: $id has no iOS screen yet"; fi
  IFS=$'\t' read -r -a extra <<<"$spec"
  # Later flags win, so a per-screen user overrides the default.
  xcrun simctl launch "$udid" "$bundle" \
    --playarr-parity-server "$server" --playarr-parity-user "$user" \
    --playarr-parity-password "${PARITY_PASSWORD:?}" "${extra[@]}" >/dev/null
  sleep "$settle"
  xcrun simctl io "$udid" screenshot --type=png "$out/$id.png"
  echo "captured $id"
done
xcrun simctl status_bar "$udid" clear || true
