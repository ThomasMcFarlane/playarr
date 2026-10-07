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
| movies | 3.03% | 0.66% | 1.46% | dark passes |
| series | 1.22% | 0.64% | 1.32% | dark passes |
| film-detail | 5.36% | 3.01% | 3.32% | open |
| series-detail | 2.19% | 1.89% | 3.60% | open |
| search | 1.06% | 0.96% | 1.17% | dark passes |
| calendar | 5.78% | 1.27% | 1.39% | open |
| settings | 1.72% | 1.60% | 3.54% | open |
| player-controls | 92.94% | 13.68% | 13.17% | video frame masked, chrome open |
| player-quality-menu | 65.52% | 12.91% | 12.57% | video frame masked, chrome open |
| profile-switcher | 6.20% | 1.46% | 1.66% | open |
| household-blocked | 1.08% | 0.39% | 0.38% | passes in both themes |

"Dark before" is the table from the first Android TV parity change. Its references were measured without the TV user agent
and with a stale web build, so "before" and "now" are not strictly comparable; the direction is. The player rows now mask the
video area (y 100 to 900, and around the quality popover): the clip has a running timestamp and is scaled by different
decoders, so only the chrome around the frame is compared. What remains in those rows is the video behind the bottom control bar
and the top buttons, which cannot be masked without hiding the chrome.

## What changed

- Home leads with "Start watching"; rails and cards use the web sizes, 25 dp gap, 6 dp lift and 1.025 art scale,
  no count line; "Customise Home" is the small pill at the top right.
- Hero block: web type, 9ch title width, two-line titles drawn line by line, the web scrim and key-art geometry
  (52% wide, 106% tall, scaled 1.04, top aligned, 72% mask) so the key art lines up in both themes.
- Library grid and A-Z rail follow web (card 327 dp, 25.92 x 27 gaps, the selected title's letter highlighted).
- Detail: web pills (Download, Playback, Play, Add to watchlist), web meta chips (Movie, runtime, year, Released ..., genres),
  and the Chapters and Similar Titles tracks at x 881.6 starting at y 540.
- Series detail: web episode rail (heading block 46 dp with the Download button at x 1828, cards on a 314.8 dp track pitch, selected card lifted 7 dp), availability note between meta and synopsis, ink Start pill.
- Quality menu: web popover (620 x 408 at x 1074.8, y 540) with the Original choice over the Low, Medium and High matrix instead of a side panel.
- Player: icon-only 48 dp close circle and labelled Minimise pill at y 37.8, web bottom bar (6 dp seek track, 64 dp round controls),
  Playback health and Play on another device moved from the top-left pills to the bottom bar where web puts them
  (cast, when available, sits with them).
- Search: web search pill, Filters pill, preview and a results panel at x 825.6.
- Profiles: web sizes (244 dp avatars, 80.64 sp heading), add-profile plate gradient, theme and language dropdown positions.
- Household blocked: the web empty-state tile and outlined pills; the rail, clock and profile chip stay around it.
- Settings numbering is two digits (10, not 010).
- Tokens that were fixed to dark values (back button, divider, A-Z chip, detail pills, hero scrim) now follow the theme.

## Remaining differences

- series-detail: small offsets in the left column and the card art; web now also has the Add to Playlist pill and the season Download button (web PR for row 473), so those match.
- film-detail and series-detail: pill glyphs. Web draws them as text characters (a down arrow, a trigram, a play triangle and a plus)
  from whatever symbol font the browser falls back to; Android draws the same characters with its own fallback font.
  There is no web SVG for them to port.
- calendar, settings and home: small spacing and icon differences.
- Player: the video area cannot match (running timestamp, different decoders).

## Re-baseline against the shared references

Measured against `docs/parity/web/tv/{light,dark}` with `diff.mjs --theme both` semantics (per theme), the clock
and the player video frame masked, after the TV layout work in this directory landed on main. The fixtures were
seeded with the deterministic seed and the artwork came from `PLAYARR_FIXTURE_PUBLIC_HOST=10.0.2.2`.

| Screen | Dark | Light |
| --- | ---: | ---: |
| home | 2.44% | 3.27% |
| movies | 4.18% | capture artefact (artwork not yet loaded) |
| series | 0.84% | 1.56% |
| film-detail | 3.88% | 4.21% |
| series-detail | 4.76% | capture artefact (artwork not yet loaded) |
| search | 1.61% | 3.44% |
| calendar | 0.70% | 2.04% |
| settings | 1.42% | 3.35% |
| player-controls | 13.64% | 13.64% |
| player-quality-menu | 14.55% | 14.55% |
| profile-switcher | 1.52% | 1.69% |
| household-blocked | 0.42% | 0.42% |

The two artefact rows read about 28% because the poster images had not finished loading in the emulator when the
screenshot was taken (the software renderer is slow); a second capture of the same screens with the artwork loaded
is in the dark column. Differences that remain against the shared references:

- Typeface: the references are rendered in Nunito Sans, the Android client still uses Roboto. This is the largest
  remaining contributor on every text-heavy screen. It closes when the web font bundle is embedded (owner decision).
- The reference shows the profile name "Viewer" while the fixture client shows the username.
- The references have no "Customise Home" pill on the home screen.
- Player screens: the video frame is masked, the remaining mismatch is video pixels behind the control bar and
  the top buttons. Justified exception, agreed with the coordinator.

### With the bundled fonts (Nunito Sans, JetBrains Mono)

Android TV now embeds the same variable font files as the web, against the refreshed shared references and a fresh
fixture database. Dark: home 1.78%, movies 4.45%, series 1.18%, film-detail 3.07%, series-detail 3.95%, search 0.93%,
calendar 0.69%, settings 1.39%, profile-switcher 1.45%, household-blocked 0.43%; player screens stay video-bound
(about 14 to 24% with the frame masked). The light theme is not re-measured here: the poster images in the emulator
load only partly before a capture, which dominates its numbers, so it needs a capture run with decoded art.
The Typeface bullet above is resolved by this change.

### Detail pages, player chrome and light theme (image-idle captures)

Captured with the debug image-idle signal (`PlayarrParity images inflight=0`), a fresh 60 s fixture, the player paused at
exactly 2.0 s (`parity_pause_at_ms`) and the shared references. The player screens are compared chrome-only: the video
is full bleed, so everything is masked except the Minimise and Close pills, the bottom control band and (quality menu)
the popover panel.

| Screen | Dark | Light |
| --- | ---: | ---: |
| home | 1.35% | 2.24% |
| movies | 0.74% | 1.56% |
| series | 0.66% | 1.37% |
| film-detail | 0.91% | 1.29% |
| series-detail | 1.49% | 3.25% |
| search | 0.93% | 1.07% |
| calendar | 0.69% | 2.03% |
| settings | 1.39% | 3.33% |
| player-controls (chrome only) | 0.68% | 0.68% |
| player-quality-menu (chrome only) | 2.80% | 2.80% |
| profile-switcher | 1.45% | 1.61% |
| household-blocked | 0.43% | 0.42% |

What this change fixed: the player bottom scrim (web: transparent about 500 px above the bottom edge, 0.9 black at the
edge), the seek bar colours (crimson `#cf3157` progress, no thumb), the primary detail pill colour (crimson in both
themes, not the neutral palette accent), the web episode tile treatment (`grayscale(.25)` and a 135deg 5% to 48% black
gradient) and the series episode tiles, which now draw the series backdrop only, as the web does.

Remaining player difference: the shared references are captured without the TV user agent, so they show the volume
slider, the fullscreen button and the HD badge, and the quality popover sits 78 px further left because of the extra
fullscreen button. Android TV (like the web with the TV user agent) has neither, which is why the quality menu stays at
about 2.8%.

### Structural gaps found in the light heat maps

Percentages are a weak signal on mostly empty pages, so these were checked by eye as well. Two screens still have a different
structure from the web TV layout even though their mismatch looks small:

- Settings: the web lists the sections as a wide numbered list on the left with the selected section's panel beside
  it; Android TV draws the two-pane preferences layout (compact section list, panel card, Sign out bar). Light 3.5%,
  dark 1.6%.
- Calendar: the web TV shows the month grid (weekday header, day cells, the Sample Series 1 chip on the 10th); Android TV
  shows the agenda list with a poster card. Light 7.4%, dark 6.0%.

Series detail was fixed in this change (overview and pill row spacing, and the series-level Download pill, which the web
does not have, removed): dark 0.92%, light 1.67%.

### Settings follows the web TV layout

Android TV settings is rebuilt as the web layout: the wide numbered section list on the left (480 px, 92 px rows, selected
row filled, arrow at the right), the header rule with the section eyebrow and caption above it, and the selected
section's panel at x 774 (headings, square segmented controls, a divider), with the back button focused on entry. The
other sections reuse their existing content in the same panel. Measured against the shared references with the theme
preference chosen in the app to match (the references set it explicitly): dark 0.92%, light 0.97%.

### Calendar follows the web TV agenda

Android TV's calendar agenda is the web layout: the range label ("7 Oct – 5 Nov 2026"), the selected release's details at
the left (eyebrow, title, subtitle, RELEASE, STATUS and REPORTED BY blocks, the Play / Open series / Add to watchlist row,
no poster) and the bordered day card at the right, with the period arrows as outlined circles, Today holding the focus ring
and the bell on Calendar link. The header pills are now the outlined web pills on every TV page. Light 0.65%, dark 0.58%
(captured with the emulator on en-GB and UTC, like the references).

Dates everywhere on Android (phone and TV) now go through `PlayarrDateFormat`, which uses the same CLDR skeletons as the
web's `Intl.DateTimeFormat` ("7 Oct 2026" in en-GB, "Oct 7, 2026" in en-US) instead of hard-coded patterns, and the
range label is built as the web builds it (short start, dated end, plain spaces around the en dash).

### Settings sections

The panels next to the section list now follow the web TV: no panel title, the sections' own 26 px headings, square segmented
controls and choice cells (crimson border, bar and fill for the selected one), a select for the language, the avatar presets as
six 146 px circles four to a row, the PIN and invite fields as bordered web fields with light pills (the brand pink is not used
on these pages), the Phone remote groups with bold 16 px headings and a checkbox, the joined server inputs with the Connect pill
and the collapsed "TV app connection details", and the Your data headings and body at web size. Captured section by section
(web captured with the TV identity on a second fixture instance) the mismatch against the web is, dark: avatar 1.4%, language
0.8%, request latency 0.9%, remote 1.4%, lock 1.8%, invite 2.2%, player 2.4%, data 2.9%, server 3.6% (light within 0.3 of
dark, server 3.8%). The player quality matrix, the server cards and the data page still differ in detail (row pitch, box
heights and fonts); the section panels are not part of the shared references yet, so these figures come from my own captures.

### Cards and the hero title (light and dark)

TV cards now carry the web's drop shadows (a resting pair, a larger pair when lifted) and lift when selected on the home
rails as well as the library grid, and the hero title is measured and drawn in the web font with the web's `max-width: 9ch`
(nine "0" advances of that font) instead of the platform font's width. Against the shared references, dark: home 1.10%,
movies 0.57%, series 0.52%, film-detail 0.76%, series-detail 0.79%, search 0.94%, calendar 0.63%, settings 0.92%,
profile-switcher 1.47%, household-blocked 0.43%, player controls 0.62%, quality menu 1.17%. Light: home 1.28%, movies
0.65%, series 0.56%, film-detail 1.16%, series-detail 1.55%, search 1.08%, calendar 0.70%, settings 0.97%,
profile-switcher 1.68%, household-blocked 0.42%, player controls 0.62%, quality menu 1.17%.

### Frozen clock for captures

Debuggable builds accept `--es parity_clock 2026-10-07T12:00:00Z` on launch (the shared `FIXTURE_CLOCK`): "today" in the
calendar and the clock in the chrome then read that instant instead of the real date, so the agenda always shows 7 Oct 2026.

### Profile page

The TV profile page now has the web's background (the rose glow is a 13% circle at 50% / 48% that fades by 34% of the corner
distance, and the edge fade runs along the left and the bottom), the heading and the Sign out row at the web's heights, the
selected avatar lifted and scaled with its 4 px rose ring outside the avatar, a lighter shadow on the glass pills, and the
Clients pill at the bottom right. Clients opens a dialog with a QR code and the address of the server's clients page, since
Android TV has no browser to hand it to. Dark 1.04%, light 1.35%.
