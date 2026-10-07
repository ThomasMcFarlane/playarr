# Android phone parity (web mobile layout)

Reference: the committed web references `docs/parity/web/mobile/{light,dark}` (390x844 CSS viewport, DPR 3, 1170x2532 device
pixels, signed in as `fx-viewer`, the web's own fonts). Candidate: the Android phone client (`sideload` debug build) on a
headless emulator configured as 1170x2532 at 480 dpi, so 390x844 dp equals the web CSS viewport, against a FRESH fixture
database (`scripts/fixtures/up.sh --fresh` in an empty `PLAYARR_FIXTURE_DIR`, seeded on the day of the frozen clock: re-seeding an
old database keeps the wrong rail order). Screen ids and tolerance come from `scripts/parity/screens.json`; the diff is
`scripts/parity/diff.mjs --theme both` (pixelmatch, threshold 0.1, `includeAA: false`).

## Result

Mismatch against the web reference of the same theme, system bars masked (see below). Light and dark are both measured.

| Screen | Light | Dark | Status |
| --- | ---: | ---: | --- |
| home | 0.95% | 0.85% | pass |
| movies | 0.53% | 0.52% | pass |
| series | 0.42% | 0.44% | pass |
| film-detail | 1.00% | 0.98% | pass |
| series-detail | 1.13% | 0.71% | above 1% |
| search | 0.68% | 0.75% | pass |
| calendar | 2.54% | 2.39% | above 1% |
| settings | 1.02% | 1.04% | above 1% |
| player-controls | 0.55% | 0.55% | pass |
| player-quality-menu | 1.60% | 1.60% | above 1% |
| profile-switcher | 0.97% | 0.97% | pass |
| household-blocked | 1.02% | 0.99% | above 1% |

The screens at or below 1% have no difference worth a justification. The rest:

- **player-controls, player-quality-menu**: the decoded video frame is an agreed platform exception, so the 16:9 video
  rectangle is copied from the reference into the candidate (`scripts/parity/android-mobile/mask.py`) and the numbers above
  are chrome only. Chromium and Android's MediaCodec convert the untagged test clip's YUV to RGB with different matrices (for
  example the cyan bar is `0, 206, 229` on the web and `3, 229, 229` on Android), which is why the frame itself cannot match.
  The quality menu blurs what is behind it on Android 12 and later (a window the size of the panel with the system background
  blur on, 24 dp) and is drawn in place without blur below API 31, where the 90% tint hides most of the difference.
- Screens still above 1% (series-detail, calendar, settings, household-blocked): every text row sits within 1 to 3 px of the web (measured per row)
  and no layout difference remains; what is left is glyph anti-aliasing and sub-pixel advance differences between Chromium's
  and Android's rasterisers on the same font file, and 1 px edges of pills and borders. They are not claimed as justified
  beyond that; calendar is the largest (its agenda card and pill text carry most of it).

## What the phone client does to match

- **Fonts.** The phone client embeds the web's fonts: Nunito Sans (text) and JetBrains Mono (monospace labels), the same
  files `docs/parity/fonts` documents for native clients (`NunitoSans-wght-web.ttf`, the web's exact wght-only instance, default
  weight 200 so the weight is always set explicitly, and `JetBrainsMono[wght].ttf`; SIL OFL, licences in
  `clients/android/licenses`). Every weight the web CSS asks for is a variation of the one file. Television keeps the platform font.
- **Text rendering.** Compose's default hints glyph advances, which makes 11 sp text about 4% narrower than Chromium's
  unhinted layout. The phone text style uses `TextMotion.Animated` (subpixel positioning, no hinting), so line breaks and
  widths match, and splits leading the way Chromium does for these fonts.
- **System bars.** The web references are captured with no safe area, so there is nothing to emulate: the phone layout follows
  the web's own `max(14px, inset)` top rule and the diff masks the two OS-drawn bands (below). A debuggable build started
  with the launch extra `parity_no_insets` lays out with no system-bar insets; real devices always keep their insets.
- **Player and masks.** The video rectangle of the two player screens is masked on both sides (see below). A debuggable build started with `parity_pause_at_ms` pauses the player at that position (2000 for the
  references) once it is playing, as the web capture does.

## System bar mask

The status bar (top 72 px) and the gesture navigation bar (bottom 72 px) are drawn by Android, and the web has none.
`scripts/parity/android-mobile/mask.py` copies those two bands from the reference into the candidate, so they never count as
mismatch. On the two player screens the 16:9 video rectangle (0, 937 to 1170, 1595) is copied too, because the decoded frame
is a platform difference. Everything else is compared as captured.

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
