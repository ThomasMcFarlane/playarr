#!/usr/bin/env bash
# Drives the tvOS app (already installed on the booted simulator) to each screen of a
# screens file and captures it with simctl.
# usage: capture-tvos.sh <udid> <bundle-id> <screens.json> <server-url> <access-token> <out-dir>
set -euo pipefail
udid="$1"; bundle="$2"; screens="$3"; server="$4"; token="$5"; out="$6"
mkdir -p "$out"
node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const x of s.screens) if (x.native) console.log(x.id + "\t" + x.native);
' "$screens" | while IFS=$'\t' read -r id route; do
  xcrun simctl terminate "$udid" "$bundle" 2>/dev/null || true
  xcrun simctl launch "$udid" "$bundle" \
    -PlayarrServerURL "$server" -PlayarrAccessToken "$token" -PlayarrParityRoute "$route" >/dev/null
  sleep "${PARITY_SETTLE_SECONDS:-10}"
  xcrun simctl io "$udid" screenshot "$out/$id.png"
  echo "captured $id ($route)"
done
