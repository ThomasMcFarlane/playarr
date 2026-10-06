# Android TV pixel parity (1920x1080)

Reference: web TV layout at 1920x1080, dark theme, signed in as `fx-viewer` against the fixture
environment. Candidate: the sideload debug build on a 1080p Android TV emulator (API 36, density forced to
160 dpi by the app so 1 dp = 1 CSS px). Diff: `scripts/parity/diff.mjs` (pixelmatch threshold 0.1).
Native captures are in `tv/` (palette-quantised to keep the repository small; mismatch figures were
measured on the full-colour captures).

## How the captures were made

- Fixture server (`scripts/fixtures/up.sh`) on its own port; the web client was built from `main` and served by it.
- Web reference: Playwright, 1920x1080 at 1x, dark colour scheme, reduced motion, animations and transitions off, and
  the Android system font (Roboto, pulled from the emulator image) injected for the web UI. Without that the host
  falls back to a different typeface and every text pixel differs for a reason that has nothing to do with layout.
- Android: `adb exec-out screencap -p`, D-pad/tap navigation through the same screens, `fx-child-locked` for the household screen.
- The shell clock rectangle (x 470-730, y 60-100) is painted out in both images: the emulator clock cannot be
  frozen without root, and the web clock is frozen at 12:00.

## Mismatch per screen

| Screen | Before | After this change | Status |
| --- | ---: | ---: | --- |
| home | 2.66% | 1.65% | open |
| movies | 3.03% | 2.61% | open |
| series | 1.22% | 1.23% | open |
| film-detail | 5.36% | 4.86% | open |
| series-detail | 2.19% | 1.98% | open |
| search | 1.06% | 1.00% | at the threshold (fails the strict 1% rule by rounding) |
| calendar | 5.78% | 0.73% | pass |
| settings | 1.72% | 1.79% | open |
| player-controls | 92.94% | 92.97% | video exception, controls open |
| player-quality-menu | 65.52% | 72.82% | video exception, controls open |
| profile-switcher | 6.20% | 6.20% | open |
| household-blocked | 1.08% | 1.09% | open |

The two player rows are not comparable before and after: their "before" used a stale web reference. "Before" for the other rows was measured with the same capture setup on the unchanged `main` build.

## What changed in this step (shared chrome, every screen)

- Navigation rail follows web grouping and metrics: Calendar moves to the third group after Requests, 64 dp links,
  9.6 dp spacing, 7.68 dp group padding, 8.832 sp labels; Requests uses the same bookmark glyph as Watchlist.
- Clock right-aligned to x = 710.4 with the web type sizes; profile chip and version label use the web sizes.
- Page header: outlined back button with the arrow glyph, full-height divider, web breadcrumb type.
- Library A-Z rail: 62 x 690 at (1845.5, 270), 24 dp cells, filled circle on the active letter.

## Remaining differences (not yet fixed)

- Hero block of library, home and detail screens: web renders the title over two lines with a large watermark title
  behind it and a year/genre line; Android renders one line. Card sizes and focus scale also differ (web grid cards 327-332 dp wide).
- Home: web has a "Start watching" rail that Android lacks.
- Film detail: web shows Download, Playback and Play as large pills plus a chapters and similar-titles column; Android uses a boxed panel and a different button order.
- Profile switcher, household-blocked and settings: spacing and chrome differ (web household screen keeps the rail and an icon tile).
- Icons: web uses an outline icon set; Android uses Material outlined icons.
- Settings list prints "010" for the tenth entry on Android.

## Player screens and justified exceptions

- The web reference for the player screens was captured with a system Chromium that can decode the fixture clip,
  from a web build of `main` plus the open "align every player chrome with the X-close layout" PR (not yet on `main`).
  An earlier reference that showed Back and Minimise at the top left came from a stale web build and was discarded.
- Layout verified: the web player has Minimise to the left of a close X at the top right, the same arrangement as Android.
  They still differ in detail: web is a 47 dp icon-only circle at y 38, Android uses 48 dp labelled pills ("Minimise", "Close") at y 16, and Android adds
  "Play on another device" and "Playback health" pills at the top left that web does not show. The web quality menu is a popover grid anchored to the
  control bar; Android opens a right-hand side panel. These are open differences, not exceptions.
- Exception (video pixels only): the procedural test clip has a running timestamp and is scaled by different decoders, so the video area cannot
  match pixel for pixel. The player mismatch figures are dominated by it. Compare the overlay controls by region instead.

## Findings from the sign-in investigation

- The Play flavour deliberately blocks cleartext traffic (`usesCleartextTraffic="false"`, covered by `PlayDistributionPolicyTest`),
  so it cannot reach the loopback fixture server over HTTP; use the sideload flavour for fixture work. This is not a bug.
- BACK on the manual sign-in form leaves the app when the soft keyboard is not showing; the on-screen back button returns to the QR screen.
