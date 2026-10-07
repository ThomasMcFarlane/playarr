#!/usr/bin/env bash
# Capture the Android TV parity screens in one theme.
#   capture.sh <out-dir> <light|dark> [screen-id ...]      (default: every screen below)
# The scrolled screens (home-scrolled, movies-scrolled, series-scrolled) run check-edge-fade.mjs and make the script exit 1 on a
# hard-cut edge; capture the web counterpart with scripts/parity/capture-web-scrolled.mjs and compare both at the same position.
# Writes <out-dir>/tv/<theme>/<screen-id>.png, the layout diff.mjs reads, e.g.
#   node scripts/parity/diff.mjs --ref docs/parity/web --cand <out-dir> --layout tv --theme dark --chrome-only
#
# Needs: adb on PATH (ANDROID_SERIAL picks the device), the sideload DEBUG APK installed (debug builds honour the parity
# extras and log image loading), an emulator or box at 1920x1080 / 160 dpi (the script sets en-GB and UTC after clearing
# the app data, because the references are captured in en-GB and UTC), and the fixture server (scripts/fixtures/up.sh --fresh, PLAYARR_FIXTURE_CLIP_SECONDS=60, PLAYARR_FIXTURE_PUBLIC_HOST=10.0.2.2).
# Environment: PARITY_SERVER (default http://10.0.2.2:18660), PARITY_PASSWORD (the fixture password),
# PLAYARR_FIXTURE_DB (optional: the fixture's SQLite file, whose watch_progress is cleared before each run).
#
# Each run clears the app data first (a leftover explicit theme, saved profile or paired device would change the screens),
# signs in as fx-viewer, and chooses the app's own theme (not the system appearance) in the display preferences.
set -euo pipefail
out=$1; theme=$2; shift 2
case $theme in light) pref=Light ;; dark) pref=Dark ;; *) echo "theme must be light or dark" >&2; exit 2 ;; esac
server=${PARITY_SERVER:-http://10.0.2.2:18660}
password=${PARITY_PASSWORD:-fixture-pass-0001}
pkg=io.playarr.mobile
dest="$out/tv/$theme"; mkdir -p "$dest"
# The fixture clock (scripts/fixtures/catalog.mjs FIXTURE_CLOCK): "today" and the chrome clock in debug builds.
clock=2026-10-07T12:00:00Z

tap() { adb shell input tap "$1" "$2"; }
key() { adb shell input keyevent "KEYCODE_$1"; }
launch() { adb shell am force-stop $pkg; adb shell am start --el parity_pause_at_ms 2000 --es parity_clock $clock -n $pkg/.MainActivity >/dev/null; }

# The debug build logs `PlayarrParity images inflight=N failed=M`; wait for three idle polls, then screenshot.
shoot() {
  local id=$1 settle=${2:-2} idle=0 last=""
  sleep "$settle"
  for _ in $(seq 1 40); do
    last=$(adb logcat -d -s PlayarrParity:I 2>/dev/null | tail -1 || true)
    case $last in *"inflight=0"*) idle=$((idle + 1)) ;; *) idle=0 ;; esac
    [ $idle -ge 3 ] && break
    sleep 1
  done
  sleep 0.5
  adb exec-out screencap -p > "$dest/$id.png"
}

sign_in() { # from the QR sign-in screen: Sign in manually against the fixture server
  local user=$1
  tap 960 898; sleep 2
  tap 960 445; sleep 1
  key MOVE_END; adb shell 'for i in $(seq 1 60); do input keyevent KEYCODE_DEL; done'
  adb shell input text "$server"; key TAB
  adb shell 'for i in $(seq 1 40); do input keyevent KEYCODE_DEL; done'; adb shell input text "$user"; key TAB
  adb shell 'for i in $(seq 1 40); do input keyevent KEYCODE_DEL; done'; adb shell input text "$password"; key ENTER; sleep 1
  tap 960 771; sleep 8
}

fresh_session() { # $1 = user
  adb shell pm clear $pkg >/dev/null
  # Clearing the data also clears the app language and the zone is a device setting: set both after every clear.
  adb shell cmd alarm set-timezone UTC >/dev/null 2>&1 || true
  adb shell cmd locale set-app-locales $pkg --locales en-GB >/dev/null 2>&1 || true
  adb shell am start -n $pkg/.MainActivity >/dev/null; sleep 8
  sign_in "$1"
  adb shell am force-stop $pkg
  adb shell "run-as $pkg sh -c 'mkdir -p shared_prefs; echo \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?><map><string name=\\\"theme\\\">$pref</string></map>\" > shared_prefs/playarr_display.xml'"
}

rail() { # rail entries (x 81): downloads search home series movies playlists watchlist requests calendar
  case $1 in
    downloads) tap 81 210 ;; search) tap 81 300 ;; home) tap 81 396 ;; series) tap 81 468 ;; movies) tap 81 540 ;;
    watchlist) tap 81 700 ;; requests) tap 81 774 ;; calendar) tap 81 842 ;;
  esac
}

screens=("$@")
[ ${#screens[@]} -eq 0 ] && screens=(home series series-detail movies film-detail calendar search downloads watchlist requests \
  profile-switcher settings settings-avatar settings-language settings-player settings-server settings-lock settings-invite \
  settings-latency settings-remote settings-your-data player-controls player-quality-menu home-scrolled movies-scrolled series-scrolled household-blocked)

[ -n "${PLAYARR_FIXTURE_DB:-}" ] && sqlite3 "$PLAYARR_FIXTURE_DB" "delete from watch_progress"
need_viewer=0
for s in "${screens[@]}"; do [ "$s" != household-blocked ] && need_viewer=1; done
if [ $need_viewer = 1 ]; then
  fresh_session fx-viewer
  launch; sleep 6
fi

settings_open=0
open_settings() {
  [ $settings_open = 1 ] && return
  tap 110 1006; sleep 3; tap 760 736; sleep 4; settings_open=1
}
section_row() { # settings list row for a section
  case $1 in settings) echo 0 ;; settings-avatar) echo 1 ;; settings-language) echo 2 ;; settings-player) echo 3 ;;
    settings-server) echo 4 ;; settings-lock) echo 5 ;; settings-invite) echo 6 ;; settings-latency) echo 7 ;;
    settings-remote) echo 8 ;; settings-your-data) echo 9 ;; esac
}

fade_failed=0
for id in "${screens[@]}"; do
  case $id in
    home|series|movies|calendar|downloads|watchlist|requests)
      rail "$id"; shoot "$id" 3 ;;
    home-scrolled|movies-scrolled|series-scrolled)
      # Scrolled states, mandatory in every parity run: the rail (or grid) is dragged so cards continue past its edges, then the
      # edge fade is checked (check-edge-fade.mjs fails a hard-cut edge). The fixture has few titles; a container that cannot
      # scroll is reported, not silently passed.
      # Start from a clean Home: the screen before may still be the player (its last BACK can land on the finished overlay).
      launch; sleep 12
      case $id in
        home-scrolled) rail home; sleep 3; shoot home-before-scroll 1
          adb shell input swipe 1750 568 650 568 500; sleep 1.5
          shoot home-scrolled 1
          # Left gutter of the first rail (x 730 to 882 at 1920 px, `--tv-track-left-fade`), rows of its cards.
          node "$(dirname "$0")/../check-edge-fade.mjs" "$dest/home-scrolled.png" --edge left --band 730,500,882,640 --interior 882,500,1100,640 \
            --bg "$([ "$theme" = dark ] && echo '#151315' || echo '#f5f3f2')" --max-ratio 0.35 || fade_failed=1 ;;
        movies-scrolled|series-scrolled) rail "${id%-scrolled}"; sleep 3; shoot "${id%-scrolled}-before-scroll" 1
          adb shell input swipe 1300 800 1300 200 500; sleep 1.5; shoot "$id" 1
          if cmp -s "$dest/${id%-scrolled}-before-scroll.png" "$dest/$id.png"; then
            echo "NOTE: $id: the grid did not scroll with this fixture (too few titles); no edge to check" >&2
          else
            node "$(dirname "$0")/../check-edge-fade.mjs" "$dest/$id.png" --edge top --band 900,150,1700,230 \
              --bg "$([ "$theme" = dark ] && echo '#151315' || echo '#f5f3f2')" --max-ratio 0.75 || fade_failed=1
          fi ;;
      esac ;;
    search) # the reference has the query "Sample" typed and its results shown
      rail search; sleep 3; tap 450 210; sleep 1; adb shell input text Sample; sleep 4; key BACK; sleep 2; shoot search 1 ;;
    series-detail) rail series; sleep 3; tap 888 262; sleep 4; shoot series-detail 1; key BACK; sleep 2 ;;
    film-detail) rail movies; sleep 3; tap 888 262; sleep 4; shoot film-detail 1; key BACK; sleep 2 ;;
    profile-switcher) tap 110 1006; sleep 3; shoot profile-switcher 0; key BACK; sleep 2 ;;
    settings*) open_settings; tap 300 $((208 + 92 * $(section_row "$id"))); sleep 3; shoot "$id" 1 ;;
    player-controls) rail movies; sleep 3; tap 888 262; sleep 4; tap 547 520; sleep 8; key DPAD_UP; sleep 1; shoot player-controls 0 ;;
    player-quality-menu) tap 1616 990; sleep 1.5; shoot player-quality-menu 0; key BACK; sleep 1; key BACK; sleep 2 ;;
    household-blocked)
      fresh_session fx-child-locked; launch; sleep 12; shoot household-blocked 0 ;;
    *) echo "unknown screen: $id" >&2; exit 2 ;;
  esac
done
[ $fade_failed = 0 ] || { echo "FAIL: a scrolled capture has a hard-cut edge (see check-edge-fade.mjs lines above)" >&2; exit 1; }
