# Android phone parity (web mobile layout)

Reference: the web client at a 390x844 CSS viewport, DPR 3 (1170x2532 device pixels), signed in as
`fx-viewer` on the fixture environment. Candidate: the Android phone client (`sideload` debug build)
on a headless emulator configured as 1170x2532 at 480 dpi, so 390x844 dp equals the web CSS viewport.
Screen ids and tolerance come from `scripts/parity/screens.json`; the diff is `scripts/parity/diff.mjs`
(pixelmatch, threshold 0.1, `includeAA: false`).

## Baseline (first measurement, nothing fixed yet)

| Screen | Mismatch | Note |
| --- | ---: | --- |
| home | 4.49% | Reference predates the web left-align fix (row rails were inset and spaced). Android rails already start at the 16 dp page gutter. Row order and bottom navigation differ. |
| movies | 2.85% | |
| series | 2.56% | |
| film-detail | 15.92% | |
| series-detail | 9.34% | |
| search | 4.00% | Query "Sample". |
| calendar | 14.86% | |
| settings | 4.50% | |
| player-controls | 53.05% | Not comparable yet: the web reference capture opened the web "Playback settings" page instead of the player, and the 6 second fixture clip is at a different frame on each side. |
| player-quality-menu | not captured | Android capture not reliable on the emulator (the clip ends before the menu is reached); web reference missing. |
| profile-switcher | 12.57% | |
| household-blocked | 5.11% | |

Every screen is above the 1% limit. None is at an accepted exception yet. `report-baseline.json` has the
raw numbers; `mobile/` holds the masked Android captures.

## System bar mask

The status bar (top 96 px) and the gesture navigation bar (bottom 72 px) are drawn by Android, and the
web has no equivalent. `scripts/parity/android-mobile/mask.py` copies those two bands from the reference
into the candidate, so they never count as mismatch. Everything else is compared as captured.

## Reproduce

1. Create an AVD (API 35, Google APIs) with `hw.lcd.width=1170`, `hw.lcd.height=2532`, `hw.lcd.density=480`;
   boot it headless with `-skin 1170x2532` inside a memory scope. Dark theme, animation scales 0.
2. Bring up the fixture environment (`scripts/fixtures/up.sh`) and use the `sideload` debug build: the `play`
   flavour refuses cleartext, so it cannot reach `http://10.0.2.2:<port>`. Sign in as `fx-viewer`.
3. `python3 scripts/parity/android-mobile/capture.py <raw-dir> home movies series ...`
4. `python3 scripts/parity/android-mobile/mask.py <web-ref>/mobile <raw-dir> <out>` then
   `node scripts/parity/diff.mjs --ref <web-ref> --cand <out> --layout mobile`.

## Known gaps in this first pass

- Web reference was taken from main, not from the branch with the home left-align fix, and not with the final
  `capture-web.mjs` (clock freeze, search text). Re-run once those land.
- The household blocked screen shows the signed-in profile button on web but not on Android.
- Player screens need a frozen frame; the fixture clip is 6 seconds long.
