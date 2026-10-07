#!/usr/bin/env bash
# Captures the Play listing screenshots from a running Android emulator against the showcase server (up.sh).
#
#   scripts/showcase/capture-android.sh phone emulator-5590 path/to/app.apk
#   scripts/showcase/capture-android.sh tv    emulator-5592 path/to/app.apk
#
# Start from a fresh database (up.sh --fresh) so the detail page offers Play rather than Resume.
# Run phone first: playing the film there puts it in the on-deck rail that the TV home shot shows.
# The emulator must be 1080x2400 (phone) or 1920x1080 (TV, Android TV image) and able to reach the host as
# 10.0.2.2. Run emulators headless inside a memory scope. Afterwards run
# `node scripts/showcase/manifest.mjs --write`.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
KIND="${1:?phone|tv}"; SERIAL="${2:?adb serial}"; APK="${3:?apk path}"
OUT="${SC_REPO_ROOT}/clients/android/fastlane/metadata/android/en-US/images/${KIND}Screenshots"
PKG=io.playarr.mobile
FIELD_DY=$([[ "${KIND}" == tv ]] && echo 48 || echo 127)   # label centre to input centre
PASS="$(cat "${SC_PASSWORD_FILE}")"
A() { adb -s "${SERIAL}" "$@"; }

# Centre of the first UI node whose text or content-desc equals $1 (prints "x y"); empty when absent.
find_node() {
  A shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  A shell cat /sdcard/ui.xml | python3 -c '
import re, sys
want = sys.argv[1]
for n in re.finditer(r"<node[^>]*>", sys.stdin.read()):
    n = n.group(0)
    t = re.search(r" text=\"([^\"]*)\"", n).group(1)
    d = re.search(r"content-desc=\"([^\"]*)\"", n).group(1)
    if want in (t, d) or (want.endswith("*") and (t.startswith(want[:-1]) or d.startswith(want[:-1]))):
        x1, y1, x2, y2 = map(int, re.findall(r"\d+", re.search(r"bounds=\"([^\"]*)\"", n).group(1)))
        print((x1 + x2) // 2, (y1 + y2) // 2); break' "$1"
}
tap_node() { local p; for _ in $(seq 1 15); do p="$(find_node "$1")"; [[ -n "$p" ]] && { A shell input tap ${p}; return; }; sleep 1; done; echo "capture-android: '$1' not found (screen saved to ${SC_DIR}/capture-failure.png)" >&2; A exec-out screencap -p >"${SC_DIR}/capture-failure.png"; exit 1; }
shot() { A exec-out screencap -p >"$1"; echo "wrote ${1#"${SC_REPO_ROOT}/"}"; }

A install -r "${APK}" >/dev/null
A shell pm clear "${PKG}" >/dev/null
A shell monkey -p "${PKG}" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 8
[[ "${KIND}" == tv ]] && tap_node "Sign in manually"
sleep 2
# Types $1 into the focused field and verifies it (a loaded emulator drops keystrokes); retries up to 5 times.
edit_texts() { # prints the text of every EditText, one per line
  A shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  A shell cat /sdcard/ui.xml | python3 -c '
import re, sys, html
for n in re.finditer(r"<node[^>]*class=\"android.widget.EditText\"[^>]*>", sys.stdin.read()):
    print(html.unescape(re.search(r" text=\"([^\"]*)\"", n.group(0)).group(1)))'
}
type_field() { # index text secret
  local i="$1" want="$2" secret="${3:-}" got
  for _ in 1 2 3 4 5; do
    A shell input keyevent KEYCODE_MOVE_END; for _ in $(seq 1 60); do A shell input keyevent 67; done
    A shell input text "${want}"; sleep 1
    got="$(edit_texts | sed -n "$((i + 1))p")"
    if [[ -n "${secret}" ]]; then [[ ${#got} -eq ${#want} ]] && return; else [[ "${got}" == "${want}" ]] && return; fi
  done
  echo "capture-android: could not type field $i (got '${got}')" >&2; A exec-out screencap -p >"${SC_DIR}/capture-failure.png"; exit 1
}
focus_field() { local y; y="$(find_node "$1" | cut -d' ' -f2)"; A shell input tap 540 $((y + FIELD_DY)); sleep 1; }
focus_field "SERVER URL"; type_field 0 "http://10.0.2.2:${SC_BASE_PORT}"
A shell input keyevent KEYCODE_TAB; type_field 1 "${SC_USER}"
A shell input keyevent KEYCODE_TAB; type_field 2 "${PASS}" secret
A shell input keyevent 66; sleep 2     # the IME action closes the keyboard
tap_node "Sign in"
sleep 15

if [[ "${KIND}" == tv ]]; then
  # Focus starts on the continue-watching card once progress exists; the first run has none, so open the film.
  tap_node "Movies"; sleep 5
  tap_node "Big Buck Bunny"; sleep 6
  shot "${OUT}/02-native-detail.png"
  A shell input keyevent 4; A shell input keyevent 4; sleep 2
  tap_node "Home"; sleep 5
  shot "${OUT}/01-native-home.png"
else
  tap_node "Movies"; sleep 5
  tap_node "Big Buck Bunny"; sleep 6
  shot "${OUT}/02-native-detail.png"
  tap_node "Play"; sleep 20                    # first run on a fresh database (up.sh --fresh)
  A shell input tap 330 2028; sleep 5          # seek to the second chapter
  A shell input tap 540 1000; sleep 1          # reveal the controls
  shot "${OUT}/03-native-playback.png"
  tap_node "Close player"; sleep 3
  tap_node "Home"; sleep 6
  shot "${OUT}/01-native-home.png"             # the film now sits in the on-deck rail
fi
