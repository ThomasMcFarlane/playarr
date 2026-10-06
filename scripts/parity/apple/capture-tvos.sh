#!/usr/bin/env bash
# Drives the tvOS app (already installed on the booted simulator) to each screen of a
# screens file and captures it with simctl. A screen may name another fixture user (`user`).
# usage: capture-tvos.sh <udid> <bundle-id> <screens.json> <server-url> <default-access-token> <out-dir>
set -euo pipefail
udid="$1"; bundle="$2"; screens="$3"; server="$4"; token="$5"; out="$6"
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$out"
user_token() {
  node --input-type=module -e '
    import(process.argv[1]).then(async (m) => {
      const r = await fetch(process.argv[2] + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: process.argv[3], password: m.FIXTURE_PASSWORD, device_id: "22222222-2222-4222-8222-222222222223",
          device_name: "parity-tvos", client_platform: "ios", client_version: "parity" }) });
      console.log((await r.json()).access_token);
    });' "$here/../../fixtures/catalog.mjs" "$server" "$1"
}
node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const x of s.screens) if (x.native) console.log([x.id, x.native, x.user || ""].join("\t"));
' "$screens" | while IFS=$'\t' read -r id route user; do
  tok="$token"
  if [[ -n "$user" ]]; then tok="$(user_token "$user")"; fi
  echo "token subject: $(echo "$tok" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null | sed -E 's/.*"sub":"([^"]*)".*/\1/' | head -c 40)"
  xcrun simctl terminate "$udid" "$bundle" 2>/dev/null || true
  xcrun simctl launch "$udid" "$bundle" \
    -PlayarrServerURL "$server" -PlayarrAccessToken "$tok" -PlayarrParityRoute "$route" -PlayarrTheme "${PARITY_THEME:-dark}" >/dev/null
  sleep "${PARITY_SETTLE_SECONDS:-10}"
  xcrun simctl io "$udid" screenshot "$out/$id.png"
  echo "captured $id ($route)"
done
