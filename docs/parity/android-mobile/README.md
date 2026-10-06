# Android phone parity (web mobile layout)

Reference: the web client at a 390x844 CSS viewport, DPR 3 (1170x2532 device pixels), signed in as `fx-viewer` on the
fixture environment. Candidate: the Android phone client (`sideload` debug build) on a headless emulator configured as
1170x2532 at 480 dpi, so 390x844 dp equals the web CSS viewport. Screen ids and tolerance come from
`scripts/parity/screens.json`; the diff is `scripts/parity/diff.mjs` (pixelmatch, threshold 0.1, `includeAA: false`).

## Both themes

Phone tokens are theme-adaptive (`WebPalette` plus `webHairline`, the key-art and shadow layers); nothing is hard-coded to one
theme. The emulator is switched with `adb shell cmd uimode night yes|no` and every screen is captured and diffed against the
web reference of the same theme.

## Result (this PR)

Mismatch against the web reference of the same theme, system bars masked (see below):

| Screen | Light | Dark | Status |
| --- | ---: | ---: | --- |
| home | 2.44% | 1.34% | above 1% |
| movies | 0.48% | 0.47% | pass |
| series | 0.40% | 0.39% | pass |
| search | 1.52% | 1.00% | above 1% |
| settings | 1.25% | 1.27% | above 1% |
| film-detail | 1.17% | 1.16% | above 1% |
| series-detail | 1.37% | 1.05% | above 1% |
| calendar | 3.00% | 2.83% | above 1%, the web Play action is not ported |
| player-controls | not measured | not measured | open |
| player-quality-menu | not measured | not measured | open |
| profile-switcher | not measured | not measured | open (Android layout is a different design) |
| household-blocked | not measured | not measured | open (Android layout is a different design) |

Before this work (first measurement, dark theme, before the fixture gained artwork): home 4.49%, movies 2.85%, series 2.56%,
film-detail 15.92%, series-detail 9.34%, search 4.00%, calendar 14.86%, settings 4.50%, profile-switcher 12.57%,
household-blocked 5.11%.

Remaining differences on the measured screens are text-only: the same words in the same places, but each glyph run is
rasterised by Android's text stack instead of Chromium's, and advance widths at 8 to 11 px differ by 1 to 3% (for example
settings subtitles), so a line drifts by up to 3 px at its far end. That is the "OS font rasterisation" class of difference
and accounts for most of the 1.0 to 1.5% residue; it is not a layout difference. The 2 to 3% screens (home, calendar) have
real remaining layout gaps: the rail edge fade and the Play action (calendar).

## Reference profile

The committed web references in `docs/parity/web` are captured with the host's fonts and no system bars. A phone cannot
match that exactly (Android draws status and gesture bars, and uses Roboto), so the Android references are the same
`capture-web.mjs` run with its platform profile options, which change only what the platform dictates:

```sh
node scripts/parity/capture-web.mjs --base <fixture url> --layouts mobile --out <dir> \
  --safe-area 24,24 --font <Roboto-Regular.ttf pulled from the emulator> --color-scheme light|dark
```

- `--safe-area 24,24`: Android's status bar and gesture bar are 24 dp (72 px at 480 dpi); the web's `env(safe-area-inset-*)`
  rules then lay out exactly as on the device.
- `--font`: one font file for every run (Roboto, `/system/fonts/Roboto-Regular.ttf` from the emulator image) so text
  metrics are identical; Chromium runs with `--font-render-hinting=none`.
- The emulator uses locale `en-GB` and time zone UTC with its clock set to the capture clock (`2026-10-07T12:00:00Z`), the
  conditions `capture-web.mjs` freezes for the web.

## System bar mask

The status bar (top 72 px) and the gesture navigation bar (bottom 72 px) are drawn by Android, and the web has none.
`scripts/parity/android-mobile/mask.py` copies those two bands from the reference into the candidate, so they never count as
mismatch. Everything else is compared as captured.

## Reproduce

1. Create an AVD (API 35, Google APIs) with `hw.lcd.width=1170`, `hw.lcd.height=2532`, `hw.lcd.density=480`; boot it headless
   with `-skin 1170x2532` inside a memory scope. Disable animation scales; set night mode, locale, time zone and clock as above.
2. Bring up the fixture environment (`scripts/fixtures/up.sh`) and use the `sideload` debug build: the `play` flavour refuses
   cleartext (its network security config denies it for every host, a Play policy choice; the sideload flavour allows it for
   LAN servers), so it cannot reach `http://10.0.2.2:<port>`. `adb reverse` the stub port so artwork URLs that point at the
   host's loopback resolve. Sign in as `fx-viewer`.
3. `python3 scripts/parity/android-mobile/capture.py <raw-dir> home movies series ...`
4. `python3 scripts/parity/android-mobile/mask.py <web-ref>/mobile <raw-dir> <out>` then
   `node scripts/parity/diff.mjs --ref <web-ref> --cand <out> --layout mobile`.

`mobile/light` and `mobile/dark` hold the masked Android captures (palette-quantised to keep them small); `report-light.json`
and `report-dark.json` the raw numbers.

## Known gaps

- Player screens, profile switcher and household blocked are not ported yet (the Android layouts are different designs from the
  web ones; the web profile page also overlaps its theme and language dropdowns with the heading on a phone, which is a web issue).
- Calendar: the web "Play" action for an entry is not ported (it needs the playback queue set up from the calendar).
- Settings: the web lists "Request latency" for every user; Android has no such view, so the row opens a note that it is shown in
  Playarr Web.
