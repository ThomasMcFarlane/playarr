#!/usr/bin/env python3
"""Drive the Android phone client through the parity screens and screencap each one.

Prerequisites (see docs/parity/android-mobile/README.md): an emulator at 1170x2532, 480 dpi
(390x844 dp), the sideload debug APK installed and signed in as fx-viewer, `adb` on PATH
(ANDROID_SERIAL selects the device). Usage: capture.py <out-dir> <screen-id>...
Screen ids follow scripts/parity/screens.json. Taps use uiautomator content descriptions
where the bottom navigation exposes them, and fixed 1170x2532 pixel positions otherwise.
"""
import re, subprocess, sys, time

def sh(*a):
    return subprocess.run(["adb", "shell", *a], capture_output=True, text=True).stdout

def dump():
    sh("uiautomator", "dump", "/sdcard/u.xml")
    return sh("cat", "/sdcard/u.xml")

def find(text=None, desc=None, contains=None):
    for m in re.finditer(r'<node [^>]*?text="([^"]*)"[^>]*?content-desc="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', dump()):
        t, c, a, b, e, f = m.groups()
        if (text and t == text) or (desc and c == desc) or (contains and (contains in t or contains in c)):
            return (int(a) + int(e)) // 2, (int(b) + int(f)) // 2
    return None

def tap(**k):
    p = find(**k)
    if not p:
        print("not found", k)
        return False
    sh("input", "tap", str(p[0]), str(p[1]))
    return True

def tap_xy(x, y):
    sh("input", "tap", str(x), str(y))

def shot(out, screen_id):
    time.sleep(2.5)
    with open(f"{out}/{screen_id}.png", "wb") as f:
        f.write(subprocess.run(["adb", "exec-out", "screencap", "-p"], capture_output=True).stdout)
    print("captured", screen_id)

def main(out, screens):
    for s in screens:
        if s == "home":
            tap(desc="Home")
        elif s == "series":
            tap(desc="Series")
        elif s == "movies":
            tap(desc="Movies")
        elif s == "calendar":
            # Calendar is the ninth navigation item: scroll the bar until it is on screen.
            sh("input", "swipe", "1000", "2350", "100", "2350", "250"); time.sleep(1)
            tap(desc="Calendar"); time.sleep(1.5)
            sh("input", "swipe", "100", "2350", "1000", "2350", "250")  # scroll the bar back, as the web reference shows it
        elif s == "search":
            tap(desc="Search"); time.sleep(1); tap_xy(585, 425); sh("input", "text", "Sample"); sh("input", "keyevent", "4")
        elif s == "film-detail":
            tap(desc="Movies"); time.sleep(1.5); tap(text="Test Movie A")
        elif s == "series-detail":
            tap(desc="Series"); time.sleep(1.5); tap(text="Sample Series 1")
        elif s == "profile-switcher":
            tap(contains="Profiles for")
        elif s == "settings":
            tap(contains="Profiles for"); time.sleep(2); tap_xy(159, 1299)  # gear on the profile picker
        elif s == "player-controls":
            tap(desc="Movies"); time.sleep(1.5); tap(text="Test Movie A"); time.sleep(2.5)
            tap_xy(370, 1415)  # primary Play / Resume button
            time.sleep(4); tap_xy(585, 1200)  # reveal controls
        else:
            print("unsupported screen", s); continue
        shot(out, s)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
