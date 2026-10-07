#!/usr/bin/env bash
# Capture the Fire TV parity screens on a real device, in one theme.
#   capture.sh <out-dir> <light|dark> [screen-id ...]      (default: every screen below)
# Writes <out-dir>/tv/<theme>/<screen-id>.png, the layout diff.mjs reads:
#   node scripts/parity/diff.mjs --ref <web-live-dir> --cand <out-dir> --layout tv --theme dark
# The reference comes from the SAME run: scripts/parity/fire-tv/capture-web-live.mjs against the same server and account.
#
# Environment (nothing here is committed with a value):
#   FIRETV_VEGA     the vega CLI command (for example "vega"; wrap it if your host needs a session helper)
#   FIRETV_DEVICE   the device serial, host:port
#   FIRETV_APP      the app id (default com.streamarr.firetv.main)
#   FIRETV_RAIL     the rail items the account's server shows, in order
#                   (default: downloads search home series movies music playlists watchlist requests calendar)
# The device must already be signed in as the device test account (the app opens on the profile picker). The driver only
# uses the remote: it never signs out, and it leaves the app running.
set -euo pipefail
out=$1; theme=$2; shift 2
case $theme in light|dark) ;; *) echo "theme must be light or dark" >&2; exit 2 ;; esac
: "${FIRETV_VEGA:?set FIRETV_VEGA}" "${FIRETV_DEVICE:?set FIRETV_DEVICE}"
app=${FIRETV_APP:-com.streamarr.firetv.main}
rail=(${FIRETV_RAIL:-downloads search home series movies music playlists watchlist requests calendar})
dest="$out/tv/$theme"; mkdir -p "$dest"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

vda() { timeout 60 $FIRETV_VEGA exec vda -s "$FIRETV_DEVICE" "$@"; }
# Playarr must be the visible app before EVERY key press: a press that lands on the launcher or the screensaver acts on
# somebody else's UI (an earlier run installed an app from the store that way). Abort the whole run instead.
in_front() { vda shell "vlcm list 2>/dev/null" | awk -v app="$app" '$1 == app { print $5 }' | grep -qx VISIBLE; }
key() {
  if ! in_front; then echo "capture: $app is not the visible app; refusing to press KEY_$1 and aborting" >&2; exit 3; fi
  vda shell "inputd-cli button_press KEY_$1" >/dev/null; sleep "${2:-0.7}"
}
presses() { local k=$1 n=$2; for _ in $(seq 1 "$n"); do key "$k" 0.5; done; }
grab() { vda shell "gwsi-tool-screenshooter /tmp/parity-shot.png" >/dev/null && vda pull /tmp/parity-shot.png "$1" >/dev/null; }
launch() { timeout 60 $FIRETV_VEGA device terminate-app -d "$FIRETV_DEVICE" --appName "$app" >/dev/null 2>&1 || true; sleep 1.5
           timeout 60 $FIRETV_VEGA device launch-app -d "$FIRETV_DEVICE" --appName "$app" >/dev/null; sleep "${1:-11}"
           local n; for n in $(seq 1 20); do in_front && return 0; sleep 2; done; echo "capture: $app did not come to the front" >&2; exit 3; }

# Screenshot once two grabs 1.5 s apart are identical (artwork loaded, animations finished).
shoot() {
  local id=$1 prev="" n
  for n in 1 2 3 4 5 6 7 8; do
    grab "$tmp/a.png"
    if [ -n "$prev" ] && cmp -s "$tmp/a.png" "$prev"; then break; fi
    cp "$tmp/a.png" "$tmp/prev.png"; prev="$tmp/prev.png"; sleep 1.5
  done
  cp "$tmp/a.png" "$dest/$id.png"
  echo "ok   tv/$theme/$id"
}

# Remote moves. The first key after launch only wakes focus, so every flow starts with a throwaway press.
wake() { key RIGHT 0.5; key LEFT 0.7; }
rail_index() { local i=0; for item in "${rail[@]}"; do [ "$item" = "$1" ] && { echo "$i"; return; }; i=$((i + 1)); done; echo "unknown rail item $1" >&2; exit 2; }
open_rail() { # from a content screen: LEFT enters the rail, UP walks to its top, DOWN walks to the item
  key LEFT 1; presses UP 12; presses DOWN "$(rail_index "$1")"; key ENTER 1; sleep "${2:-9}"; }
from_picker_open_home() { wake; key ENTER 1; sleep 14; }
open_settings() { # from the picker: DOWN reaches Sign out, LEFT the Preferences button
  wake; key DOWN 0.8; key LEFT 0.8; key ENTER 1; sleep 5; }
settings_section() { # the list takes focus after the back button; DOWN n+1 times for section n (0 = Appearance)
  presses DOWN "$(( $1 + 1 ))"; sleep 1.5; }
set_theme() { # Appearance panel: RIGHT enters the panel on System, Light and Dark follow
  open_settings; key RIGHT 0.8
  case $1 in light) key RIGHT 0.8 ;; dark) key RIGHT 0.8; key RIGHT 0.8 ;; esac
  key ENTER 1; sleep 3; }

[ $# -gt 0 ] && screens=("$@") || screens=(profile-switcher home movies series settings settings-avatar settings-language \
  settings-player settings-server settings-lock settings-invite settings-latency settings-remote settings-your-data)

launch; set_theme "$theme"
for id in "${screens[@]}"; do
  case $id in
    profile-switcher) launch; wake; key LEFT 0.5; shoot "$id" ;;
    home) launch; from_picker_open_home; shoot "$id" ;;
    movies|series) launch; from_picker_open_home; open_rail "$id"; shoot "$id" ;;
    settings) launch; open_settings; shoot "$id" ;;
    settings-avatar|settings-language|settings-player|settings-server|settings-lock|settings-invite|settings-latency|settings-remote|settings-your-data)
      launch; open_settings
      case $id in settings-avatar) n=1 ;; settings-language) n=2 ;; settings-player) n=3 ;; settings-server) n=4 ;; settings-lock) n=5 ;;
        settings-invite) n=6 ;; settings-latency) n=7 ;; settings-remote) n=8 ;; settings-your-data) n=9 ;; esac
      settings_section "$n"; shoot "$id" ;;
    *) echo "unknown screen: $id" >&2; exit 2 ;;
  esac
done
