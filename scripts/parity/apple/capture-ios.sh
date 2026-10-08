#!/usr/bin/env bash
# Drives the iOS app (already installed on the booted simulator) to each screen of a screens
# file and captures it with simctl. The app signs itself in from launch arguments
# (clients/ios/Sources/PlayarrApp/ParityLaunch.swift).
# usage: capture-ios.sh <udid> <bundle-id> <screens.json> <server-url> <password> <out-dir>
set -euo pipefail
udid="$1"; bundle="$2"; screens="$3"; server="$4"; password="$5"; out="$6"
mkdir -p "$out"
# Deterministic status bar (the band is masked in the diff anyway).
xcrun simctl status_bar "$udid" override --time 9:41 --batteryState charged --batteryLevel 100 \
  --cellularMode active --cellularBars 4 --wifiBars 3 || true
fixture_clock="$(node "$(dirname "$0")/fixture-clock.mjs")"
node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  // PARITY_PHASE=players captures only the player screens, PARITY_PHASE=rest everything else: playing a film records
  // watch progress, which would reshape the Home rails of any screen captured afterwards.
  const phase = process.env.PARITY_PHASE ?? "";
  for (const x of s.screens) if (x.native && (phase === "" || (phase === "players") === x.id.startsWith("player"))) console.log([x.id, x.native, x.nativeUser ?? s.user, x.settle ?? ""].join("\t"));
' "$screens" | while IFS=$'\t' read -r id route user settle; do
  xcrun simctl terminate "$udid" "$bundle" 2>/dev/null || true
  xcrun simctl launch "$udid" "$bundle" \
    --playarr-parity-server "$server" --playarr-parity-user "$user" \
    --playarr-parity-password "$password" --playarr-parity-route "$route" \
    --playarr-parity-now "$fixture_clock" ${PARITY_THEME:+--playarr-parity-theme "$PARITY_THEME"} >/dev/null
  sleep "${settle:-${PARITY_SETTLE_SECONDS:-8}}"
  xcrun simctl io "$udid" screenshot --type=png "$out/$id.png"
  echo "captured $id ($route as $user)"
done
xcrun simctl status_bar "$udid" clear || true
