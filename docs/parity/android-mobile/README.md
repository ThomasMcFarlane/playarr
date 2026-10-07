# Android phone parity (web mobile layout)

Reference: the web client at a 390x844 CSS viewport, DPR 3 (1170x2532 device pixels), signed in as `fx-viewer` on the
fixture environment, captured with the shared tooling (`scripts/parity/capture-web.mjs`, no safe area, the web's own fonts,
both themes). Candidate: the Android phone client (`sideload` debug build) on a headless emulator configured as 1170x2532
at 480 dpi, so 390x844 dp equals the web CSS viewport. Screen ids and tolerance come from `scripts/parity/screens.json`; the
diff is `scripts/parity/diff.mjs --theme both` (pixelmatch, threshold 0.1, `includeAA: false`).

## Result

Mismatch against the web reference of the same theme, system bars masked (see below). The references were captured on the
same fixture database as the Android captures (the home rails, the watch history and the calendar dates depend on the
database, so a different fixture run changes them: measured against the committed `docs/parity/web/mobile` references, the Start
watching rail on Home lists series first and the Test Movie C artwork is lighter, which is fixture data, not the client). Light and
dark are both measured.

| Screen | Light | Dark | Status |
| --- | ---: | ---: | --- |
| home | 0.95% | 0.85% | pass |
| movies | 0.53% | 0.53% | pass |
| series | 0.41% | 0.43% | pass |
| film-detail | 1.00% | 0.99% | pass |
| series-detail | 1.14% | 0.72% | above 1% |
| search | 0.61% | 0.76% | pass |
| calendar | 2.59% | 2.43% | above 1% |
| settings | 1.35% | 1.36% | above 1% |
| player-controls | 5.18% | 5.18% | above 1% |
| player-quality-menu | 4.24% | 4.24% | above 1% |
| profile-switcher | 0.97% | 0.97% | pass |
| household-blocked | 1.02% | 0.99% | above 1% |

The screens at or below 1% have no difference worth a justification. The rest:

- **player-controls, player-quality-menu**: the two screens differ mostly inside the video frame. Chromium and Android's
  MediaCodec convert the untagged test clip's YUV to RGB with different matrices (for example the cyan bar is
  `0, 206, 229` on the web and `3, 229, 229` on Android), so a quarter of the screen differs by more than the pixelmatch
  threshold (4.6% of the image on the controls screen, measured by masking the video band; everything outside it is 0.6%).
  The quality menu also draws over a blurred frame on the web (`backdrop-filter`), which the phone panel does not reproduce.
  Both are platform differences in the video decoder and compositor, not layout.
- **calendar** (2.6% light, 2.4% dark), **settings** (1.4%), **series-detail** light (1.1%), **household-blocked** light
  (1.0%): every text row sits within 1 to 3 px of the web (measured per row), and the remaining mismatch is glyph
  anti-aliasing and sub-pixel advance differences between Chromium's and Android's rasterisers on the same font file, plus
  1 px edges of pills and borders. No layout difference remains on these screens.

## What the phone client does to match

- **Fonts.** The phone client embeds the web's fonts: Nunito Sans (text) and JetBrains Mono (monospace labels), the same
  variable files the web bundles (`docs/parity/fonts`, SIL OFL; licences in `clients/android/licenses`). Every weight the web
  CSS asks for is a variation of the one file. Television keeps the platform font.
- **Text rendering.** Compose's default hints glyph advances, which makes 11 sp text about 4% narrower than Chromium's
  unhinted layout. The phone text style uses `TextMotion.Animated` (subpixel positioning, no hinting), so line breaks and
  widths match, and splits leading the way Chromium does for these fonts.
- **System bars.** The web references are captured with no safe area, so there is nothing to emulate: the phone layout follows
  the web's own `max(14px, inset)` top rule and the diff masks the two OS-drawn bands (below). A debuggable build started
  with the launch extra `parity_no_insets` lays out with no system-bar insets; real devices always keep their insets.
- **Player.** A debuggable build started with `parity_pause_at_ms` pauses the player at that position (2000 for the
  references) once it is playing, as the web capture does.

## System bar mask

The status bar (top 72 px) and the gesture navigation bar (bottom 72 px) are drawn by Android, and the web has none.
`scripts/parity/android-mobile/mask.py` copies those two bands from the reference into the candidate, so they never count as
mismatch. Everything else is compared as captured.

## Reproduce

1. Create an AVD (API 35, Google APIs) with `hw.lcd.width=1170`, `hw.lcd.height=2532`, `hw.lcd.density=480`; boot it headless
   with `-skin 1170x2532` inside a memory scope. Disable animation scales; set the locale to en-GB, the time zone to UTC and
   the clock to the capture clock (`2026-10-07T12:00:00Z`), the conditions `capture-web.mjs` freezes for the web.
2. Bring up the fixture environment (`scripts/fixtures/up.sh`) and install the `sideload` debug build. `adb reverse` the
   stub port so artwork URLs that point at the host's loopback resolve (or start the fixture with a public host the
   emulator can reach). Sign in as `fx-viewer`.
3. `scripts/parity/android-mobile/capture.sh <raw-dir> light <screen-id>...` and again with `dark`. The script sets the
   app's own theme preference and launches the debug extras; set `PLAYARR_FIXTURE_DB` to the fixture's SQLite file so watch
   progress is cleared between screens, as in the references. The player screens need the fixture started with
   `PLAYARR_FIXTURE_CLIP_SECONDS=60`.
4. `python3 scripts/parity/android-mobile/mask.py docs/parity/web/mobile/<theme> <raw-dir> <out> <theme>` per theme, then
   `node scripts/parity/diff.mjs --ref docs/parity/web --cand <out> --layout mobile --theme both`.

`mobile/light` and `mobile/dark` hold the masked Android captures (palette-quantised to keep them small); `report-light.json`
and `report-dark.json` the raw numbers.

## Not used for parity

`scripts/parity/capture-web.mjs` still has its opt-in `--font` and `--safe-area` options from the first Android capture
harness. They are off by default and parity does not use them: the shared references are captured without them and the Android
phone client is what changed to match.
