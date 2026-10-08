#!/usr/bin/env bash
# Capture the Fire TV parity screens on a real device, in one theme, by driving it with the remote only.
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
#   FIRETV_QUERY    the search text (default "fast"; use the same text in capture-web-live.mjs)
#
# The device must already be signed in as the device test account (the app opens on the profile picker). The driver only
# uses the remote: it never signs out, installs nothing and never touches another app.
#
# SAFETY: every key press and every typed text is ONE device-side command (devk.sh, devt.sh) that first checks that the
# app is the VISIBLE application and presses only then. When it is not (the screensaver, the launcher, a crash) the driver
# aborts the whole run with exit code 3. Nothing is ever pressed on somebody else's UI.
set -euo pipefail
out=$1; theme=$2; shift 2
case $theme in light|dark) ;; *) echo "theme must be light or dark" >&2; exit 2 ;; esac
: "${FIRETV_VEGA:?set FIRETV_VEGA}" "${FIRETV_DEVICE:?set FIRETV_DEVICE}"
app=${FIRETV_APP:-com.streamarr.firetv.main}
query=${FIRETV_QUERY:-fast}
rail=(${FIRETV_RAIL:-downloads search home series movies music playlists watchlist requests calendar})
dest="$out/tv/$theme"; mkdir -p "$dest"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

vda() { timeout 90 $FIRETV_VEGA exec vda -s "$FIRETV_DEVICE" "$@"; }

# The two guarded commands live on the device. `vis` is true only while the app is the VISIBLE application.
cat > "$tmp/devk.sh" <<EOF
vis() { vlcm list 2>/dev/null | awk '\$1=="$app"{print \$5}' | grep -qx VISIBLE; }
n=0; while [ "\$n" -lt "\${2:-0}" ]; do vis && break; n=\$((n + 1)); sleep 0.5; done
if vis; then inputd-cli button_press "KEY_\$1"; echo PRESSED; else echo ABORT; fi
EOF
cat > "$tmp/devt.sh" <<EOF
vis() { vlcm list 2>/dev/null | awk '\$1=="$app"{print \$5}' | grep -qx VISIBLE; }
if vis; then inputd-cli send_text "\$1"; echo PRESSED; else echo ABORT; fi
EOF
vda push "$tmp/devk.sh" /tmp/devk.sh >/dev/null
vda push "$tmp/devt.sh" /tmp/devt.sh >/dev/null

WAIT=0
key() {
  local result; result=$(vda shell "sh /tmp/devk.sh $1 $WAIT" 2>&1) || true
  case $result in
    *PRESSED*) sleep "${2:-0.7}" ;;
    *) echo "capture: $app is not the visible app; refusing to press KEY_$1 and aborting" >&2; exit 3 ;;
  esac
}
presses() { local k=$1 n=$2; for _ in $(seq 1 "$n"); do key "$k" 0.4; done; }
typetext() {
  local result; result=$(vda shell "sh /tmp/devt.sh '$1'" 2>&1) || true
  case $result in *PRESSED*) sleep 3 ;; *) echo "capture: $app is not the visible app; refusing to type and aborting" >&2; exit 3 ;; esac
}
grab() { vda shell "gwsi-tool-screenshooter /tmp/parity-shot.png" >/dev/null && vda pull /tmp/parity-shot.png "$1" >/dev/null; }
# Relaunch the app. The first key after a launch must follow within a few seconds (the screensaver returns once the idle
# timer has expired), so the first press waits for the app to become visible instead of sleeping.
launch() {
  timeout 60 $FIRETV_VEGA device terminate-app -d "$FIRETV_DEVICE" --appName "$app" >/dev/null 2>&1 || true; sleep 1.5
  timeout 60 $FIRETV_VEGA device launch-app -d "$FIRETV_DEVICE" --appName "$app" >/dev/null
  WAIT=30 key RIGHT 0.4; WAIT=0; key LEFT 0.7
}

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

rail_index() { local i=0; for item in "${rail[@]}"; do [ "$item" = "$1" ] && { echo "$i"; return; }; i=$((i + 1)); done; echo "unknown rail item $1" >&2; exit 2; }
open_home() { key ENTER 12; }                      # from the picker: the profile opens Home
open_rail() { key LEFT 1; presses UP 11; presses DOWN "$(rail_index "$1")"; key ENTER "${2:-7}"; }
open_settings() { key DOWN 0.8; key LEFT 0.8; key ENTER 5; }   # from the picker: Sign out, then the Preferences button
settings_section() { presses DOWN "$(( $1 + 1 ))"; sleep 2; }    # 0 = Appearance
set_theme() { # Appearance panel: RIGHT enters the panel, three more RIGHTs reach Dark (System, Light, Dark in a row); LEFT steps back to Light
  open_settings; presses RIGHT 3
  [ "$1" = light ] && key LEFT 0.8
  key ENTER 1; sleep 3; }

[ $# -gt 0 ] && screens=("$@") || screens=(profile-switcher home home-scrolled movies movies-scrolled series film-detail series-detail \
  search calendar downloads watchlist requests settings settings-avatar settings-language settings-player settings-server settings-lock \
  settings-invite settings-latency settings-remote settings-your-data settings-customise-home player-controls player-quality-menu)

set_theme "$theme"
for id in "${screens[@]}"; do
  case $id in
    profile-switcher) launch; key LEFT 0.5; sleep 1; shoot "$id" ;;
    home) launch; open_home; sleep 3; shoot "$id" ;;
    home-scrolled) launch; open_home; key DOWN 0.6; presses RIGHT 7; sleep 1; shoot "$id" ;;   # a rail scrolled right: the gutter fade
    movies|series) launch; open_home; open_rail "$id"; sleep 3; shoot "$id" ;;
    movies-scrolled) launch; open_home; open_rail movies; presses DOWN 6; sleep 2; shoot "$id" ;;  # the grid scrolled: top fade
    film-detail) launch; open_home; open_rail movies; key ENTER 10; shoot "$id" ;;
    series-detail) launch; open_home; open_rail series; key ENTER 12; shoot "$id" ;;
    search) launch; open_home; open_rail search 4; typetext "$query"; key BACK 3; shoot "$id" ;;   # the system keyboard opens on focus; BACK closes it
    calendar) launch; open_home; open_rail calendar 16; sleep 6; shoot "$id" ;;
    downloads|watchlist|requests) launch; open_home; open_rail "$id" 6; sleep 2; shoot "$id" ;;
    settings) launch; open_settings; shoot "$id" ;;
    settings-avatar|settings-language|settings-player|settings-server|settings-lock|settings-invite|settings-latency|settings-remote|settings-your-data|settings-customise-home)
      launch; open_settings
      case $id in settings-avatar) n=1 ;; settings-language) n=2 ;; settings-player) n=3 ;; settings-server) n=4 ;; settings-lock) n=5 ;;
        settings-invite) n=6 ;; settings-latency) n=7 ;; settings-remote) n=8 ;; settings-your-data) n=9 ;; settings-customise-home) n=10 ;; esac
      settings_section "$n"; shoot "$id" ;;
    # A real playback start: the first card on Home must be a title the device can play (MP4 with AAC audio); the controls
    # are revealed with UP, and the quality menu opens from the quality button on the right.
    player-controls) launch; open_home; key ENTER 10; key ENTER 14; key UP 1; shoot "$id" ;;
    player-quality-menu) launch; open_home; key ENTER 10; key ENTER 14; key UP 1; key RIGHT 0.6; key RIGHT 0.6; key ENTER 1.5; shoot "$id" ;;
    *) echo "unknown screen: $id" >&2; exit 2 ;;
  esac
done
