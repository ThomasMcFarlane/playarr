# Android TV pixel parity (1920x1080, light and dark)

Reference: web TV layout at 1920x1080, signed in as `fx-viewer` against the fixture environment, captured with the
`PlayarrAndroidTV/` user agent so web behaves as it does on the television (no mute or fullscreen control in the player,
the "Check for updates" and "Clients" chips on the profile screen). Candidate: the sideload debug build on a 1080p Android TV
emulator (API 36, density forced to 160 dp so 1 dp = 1 CSS px), once in dark and once in light system appearance.
Diff: pixelmatch threshold 0.1 through `scripts/parity/diff.mjs`. Native captures are in `dark/` and `light/`
(palette-quantised to keep the repository small; the figures below were measured on the full-colour captures).

## How the captures were made

- Fixture server on a reserved port with generated placeholder artwork; web built from `main` plus the player chrome
  change; the web reference captured by Playwright with the system Chromium (it decodes the fixture clip), 1920x1080 at 1x,
  reduced motion, animations off and the Android system font (Roboto) injected so text is compared like for like.
- Android: `adb exec-out screencap -p`, tap and D-pad navigation, watch progress reset before each run so detail pages match.
  `fx-child-locked` is signed in for `household-blocked`.
- The shell clock rectangle (x 470-730, y 60-100) is painted out in both images: the emulator clock cannot be frozen
  without root. Web artefacts that depend on the clock are therefore ignored.

## Mismatch per screen

| Screen | Dark before | Dark now | Light now | Status |
| --- | ---: | ---: | ---: | --- |
| home | 2.66% | 1.35% | 2.16% | open |
| movies | 3.03% | 0.64% | 1.46% | dark passes |
| series | 1.22% | 0.64% | 1.36% | dark passes |
| film-detail | 5.36% | 3.00% | 3.62% | open |
| series-detail | 2.19% | 7.00% | 9.44% | open (new web reference, see below) |
| search | 1.06% | 0.96% | 1.17% | dark passes |
| calendar | 5.78% | 1.27% | 1.39% | open |
| settings | 1.72% | 1.60% | 3.54% | open |
| player-controls | 92.94% | 52.47% | 52.39% | video exception, controls open |
| player-quality-menu | 65.52% | 55.71% | 55.67% | video exception, controls open |
| profile-switcher | 6.20% | 1.46% | 1.66% | open |
| household-blocked | 1.08% | 0.38% | 0.37% | passes in both themes |

"Dark before" is the table from the first Android TV parity change. Its references were measured without the TV
user agent and with a stale web build, so the "before" and "now" columns are not strictly comparable; the direction is.
Light was not measured before this change.

## What changed

- Home leads with "Start watching"; rails and cards use the web sizes, 25 dp gap, 6 dp lift and 1.025 art scale,
  no count line; "Customise Home" is the small pill at the top right.
- Hero block: web type, 9ch title width, two-line titles drawn line by line, the web scrim and key-art geometry
  (52% wide, 106% tall, scaled 1.04, top aligned, 72% mask) so the key art lines up in both themes.
- Library grid and A-Z rail follow web (card 327 dp, 25.92 x 27 gaps, the selected title's letter highlighted).
- Detail: web pills (Download, Playback, Play, Add to watchlist), web meta chips (Movie, runtime, year, Released ..., genres),
  and the Chapters and Similar Titles tracks at x 881.6 starting at y 540.
- Player: icon-only 48 dp close circle and labelled Minimise pill at y 37.8, web bottom bar (6 dp seek track, 64 dp round controls),
  Playback health and Play on another device moved from the top-left pills to the bottom bar where web puts them
  (cast, when available, sits with them).
- Search: web search pill, Filters pill, preview and a results panel at x 825.6.
- Profiles: web sizes (244 dp avatars, 80.64 sp heading), add-profile plate gradient, theme and language dropdown positions.
- Household blocked: the web empty-state tile and outlined pills; the rail, clock and profile chip stay around it.
- Settings numbering is two digits (10, not 010).
- Tokens that were fixed to dark values (back button, divider, A-Z chip, detail pills, hero scrim) now follow the theme.

## Remaining differences

- series-detail: the episode rail pitch and the season track offsets differ, and the Android download buttons on episode cards
  have no web counterpart on the TV layout.
- film-detail and series-detail: pill glyphs come from a different system symbol font; the Android-only "Add to Playlist" pill
  follows the web pills (web adds to playlists from the context menu).
- calendar, settings and home: small spacing and icon differences.
- Player: the video area cannot match (running timestamp, different decoders); the quality menu is a side panel on
  Android and a popover grid on web.
- Android-only: the profile screen "Clients" link exists on web only as a link to a downloads page; Android shows the same chip.
