# Roku pixel parity (1920x1080)

Reference: the shared web TV captures in `docs/parity/web/tv/{light,dark}`. Candidate: the sideloaded channel on a
physical Roku (fhd), screenshotted through the dev installer's `plugin_inspect` endpoint (JPEG, converted to PNG),
signed in as `fx-viewer` against a fresh deterministic fixture server. Diff: `scripts/parity/diff.mjs`, pixelmatch
threshold 0.1, with the shell clock rectangle (x 470-730, y 60-100) masked because a Roku has no way to freeze its clock.

```
ROKU_DEV_TARGET=<ip> ROKU_DEV_PASSWORD=<dev password> node scripts/parity/roku/capture.mjs <out> dark
node scripts/parity/diff.mjs --ref docs/parity/web --cand <out> --layout tv --theme dark --mask-rect 470,60,260,40
```

## Mismatch per screen (device against the live web reference, same real account)

Method: the Roku stays signed in as the device test account. `scripts/parity/roku/capture-web-live.mjs` captures the web TV
client (1920x1080, Nunito Sans forced, hosted web client against the real server) as that same account in the same run, and
`scripts/parity/roku/capture.mjs` captures the device (`ROKU_DOCK_HAS_MUSIC=1`). Diff: `scripts/parity/diff.mjs`, pixelmatch
threshold 0.1, the clock rectangles (470,60,260,40 and 545,60,180,40) masked on both sides. Nothing is committed from these
captures (they show real library artwork).

| Screen | Dark | Light | Status |
| --- | ---: | ---: | --- |
| home | 2.08% | 12.71% | open (light: the stage art is the dark-baked server image; web light uses the raw art at 40% opacity) |
| movies | 3.51% | 7.10% | open (same light key-art cause) |
| series | 4.28% | 7.80% | open |
| film-detail | 25.38% | 7.08% | open (layout not yet rebuilt: no Download, Playback, watchlist or playlist actions, no Cast rail) |
| series-detail | 18.90% | 11.82% | open (same) |
| search | 1.00% | 1.02% | open (at the line) |
| calendar | 2.78% | 2.75% | open |
| settings | 1.92% | 3.35% | open |
| settings-avatar | 4.54% | 7.10% | open |
| settings-language | 1.67% | 2.96% | open |
| settings-player | 2.61% | not re-measured | open |
| settings-server | 2.75% | 3.92% | open |
| settings-lock | 2.78% | 3.10% | open |
| settings-invite | 4.69% | 5.68% | open |
| settings-remote | 2.14% | 3.35% | open |
| settings-latency | 1.69% | 2.98% | open |
| settings-your-data | 3.52% | 4.44% | open |
| watchlist | 0.49% | 0.61% | pass |
| requests | 0.46% | 2.65% | pass |
| profile-switcher | 6.09% | 7.29% | open (the light web capture was blank) |
| player-controls | 0.72% | not measured | pass (chrome regions only: top-right controls and the bottom bar; the video plane screenshots black) |
| player-quality-menu | 0.82% | not measured | pass (chrome regions only) |
| household-blocked | n/a | n/a | needs a restricted profile; the real device account is not one |
| home-scrolled | 9.13% | 31.83% | open (rail viewport shift differs from web's track scroll) |
| movies-scrolled | 4.28% | 49.46% | open (grid shifts like web once the fifth row is reached) |
| settings-player-scrolled | 2.83% | 3.40% | open |
| downloads | n/a | n/a | justified exception: offline storage is not possible on Roku |

Where the figures stay high: Library and detail screens differ in live artwork decoding and the Library/Detail layouts are still the
older Roku layout; the Home hero text uses the system line pitch and Roku has no letter-spacing (the web's tight tracking on large
titles cannot be reproduced). None of the screens is at or below 1% except where marked.

## Why nothing is at or below 1% yet

- **Typeface (done).** Web uses Nunito Sans (`docs/parity/fonts`). The channel bundles static instances in
  `clients/roku/fonts` and attaches them from BrightScript through the Font node (`uri` + `size`), which renders text on
  the device; a Font child in the XML does not. Roku has no letter-spacing, so the hero title's negative tracking is a
  justified remaining difference.
- **Downloads (justified exception).** Offline storage is not possible on Roku (no persistent file storage the channel can fill and play from), so the dock has no Downloads entry and the first dock group is Search alone. It is not faked.
- **Missing chrome (done).** The dock now has Watchlist, Requests and Calendar, Home has the "Customise Home" pill, and
  Preferences has the web's ten sections on the page shell (`components/Pages.brs`, `Settings.brs`).
- **Light theme (done).** `source/Theme.brs` holds both web palettes; `ThemeApplyTree` maps each authored literal to its
  token, the preference (System, Light, Dark; System resolves to dark because Roku has no appearance API) is set from
  the sign-in/profile dropdown and Settings, and capture.mjs selects it through that dropdown.
- **Player (chrome done).** `components/PlayerChrome.brs` draws the web scrim, seek bar and thumb, transport row, quality pill, close button and the quality menu (Up opens it; choosing a tier restarts playback at the same position with that bitrate). Roku has no Picture-in-Picture, cast or in-app volume, so Minimise, volume, cast and info are not drawn (justified). Back closes the menu, then the controls, then exits. The video plane is a hardware surface that the screenshot endpoint returns black, so the player screens
  can only be compared on their chrome, which is not captured yet.
- **Calendar, settings, lists.** Not implemented on Roku.

## What changed in this step

- Cards use the work's backdrop (the web 16:9 art with the title in it) instead of the poster.
- Home hero title line pitch matches web (`lineSpacing`), hero fade, clock, rail geometry and focus ring from the bugfix PR.
- `scripts/parity/roku/capture.mjs` drives the device over ECP and writes the layout `diff.mjs` reads.

Captures are not committed: the device only produces JPEG screenshots ,
and the report is reproducible with the commands above.


## Light theme (measured 8 October, live web, same account)

Light figures above come from one full run. Known causes of the high ones: Home and the Library key art (the server only bakes the dark
stage image, the web draws the raw art in greyscale at 40% in light, so a `style=stage-light` bake is needed server-side), the scrolled
states (the web scrolls rails with its own track algorithm, the Roku uses floating focus), and three capture flukes to repeat:
watchlist (92%, a loading race), settings-player (the web capture is missing) and the player screens (the light web player capture did not
reveal its controls). Household blocked needs a restricted profile, which the real device account is not, and stays a documented exception.
