#!/usr/bin/env bash
# Capture the Android phone parity screens in one theme.
#   capture.sh <out-dir> <light|dark> <screen-id>...
# Needs: adb on PATH (ANDROID_SERIAL picks the device), the sideload debug APK installed and signed in as fx-viewer on an
# emulator at 1170x2532, 480 dpi. PLAYARR_FIXTURE_DB (optional) is the fixture server's SQLite file: its watch_progress is
# cleared before each screen so Home has no on-deck entry and the film detail offers Play, as in the web references.
set -euo pipefail
out=$1; theme=$2; shift 2
here=$(cd "$(dirname "$0")" && pwd)
case $theme in light) pref=Light ;; dark) pref=Dark ;; *) echo "theme must be light or dark" >&2; exit 2 ;; esac
mkdir -p "$out"
for screen in "$@"; do
  [ -n "${PLAYARR_FIXTURE_DB:-}" ] && sqlite3 "$PLAYARR_FIXTURE_DB" "delete from watch_progress"
  adb shell am force-stop io.playarr.mobile
  # The app's own theme choice, so the capture does not depend on the emulator's system appearance.
  adb shell "run-as io.playarr.mobile sh -c 'mkdir -p shared_prefs; echo \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?><map><string name=\\\"theme\\\">$pref</string></map>\" > shared_prefs/playarr_display.xml'"
  # parity_no_insets: lay out as the web reference does (no system-bar insets; the diff masks the bars).
  # parity_pause_at_ms: the player pauses at 2.0 s once playing. Both are honoured by debuggable builds only.
  adb shell am start --ez parity_no_insets true --el parity_pause_at_ms 2000 -n io.playarr.mobile/.MainActivity >/dev/null
  sleep 9
  python3 "$here/capture.py" "$out" "$screen"
done
