# Apple TV (tvOS) parity with the web TV layout

Reference: the committed shared web captures `docs/parity/web/tv/{light,dark}/<id>.png` (1920x1080, 1x, fixture seeded
fresh, the web's bundled Nunito Sans and JetBrains Mono). Candidate: the tvOS app in the Apple TV Simulator at 1080p,
driven by `.github/workflows/parity-apple.yml` on GitHub-hosted `macos-latest` against a fresh fixture database
(`scripts/fixtures/up.sh --fresh`, clips of 60 s), signed in as `fx-viewer` (the household screen as `fx-child-locked`),
clock frozen at 2026-10-07 12:00 UTC. Diff: `scripts/parity/diff.mjs --layout tv --theme both` (pixelmatch threshold
0.1, target 1% or less per screen and theme). Three tabs the shared list does not have (Downloads, Watchlist, Requests)
diff against a local web capture of the same run.

A screen is reached with `-PlayarrServerURL`, `-PlayarrAccessToken`, `-PlayarrTheme` and `-PlayarrParityRoute <route>`
(`home`, `movies`, `series`, `detail:<kind>:<title>`, `search:<query>`, `settings`, `calendar`, `profiles`,
`player:<title>[:quality]`, `household-blocked`, `downloads`, `watchlist`, `requests`). Routes use real server data.
The captures here are the native frames at half size (960x540, 64 colours); the workflow artifact has the full-size
native, reference and diff images and an HTML report. `shared-summary.md` and `{dark,light}/extra-summary.md` are the
raw tables.

Final run: https://github.com/ThomasMcFarlane/playarr/actions/runs/37594165924 (head 4c38bd9).

## Mismatch per screen (percent, against the shared references)

| Screen | Dark | Light |
| --- | --- | --- |
| home | 0.79 | 0.93 |
| movies library | 0.51 | 0.62 |
| series library | 0.79 | 0.87 |
| title detail (film) | 0.53 | 0.60 |
| title detail (series, seasons) | 0.85 | 0.85 |
| search with results | 0.45 | 0.62 |
| release calendar | 0.43 | 0.56 |
| settings | 0.77 | 0.76 |
| profile switcher | 0.67 | 0.77 |
| household blocked (fx-child-locked) | 0.41 | 0.39 |
| player, controls visible | 1.27 | 1.27 |
| player, quality menu open | 1.83 | 1.83 |
| Downloads, Watchlist, Requests (local capture) | 0.25 to 0.35 | 0.28 to 0.38 |

22 of 24 shared captures are at or under 1%.

## Justified differences

- Player screens (1.27% and 1.83%): the fixture clips are Matroska and the runner cannot transcode, so the native
  player cannot play them there. The video layer is the server's own frame of the clip at 2.0 s (the endpoint the chapter
  thumbnails use), colour-corrected for the browser's conversion and scaled to the stage. The remaining difference is the
  scaler along colour edges and, in the quality menu, the web's backdrop blur behind the panel. Chrome (scrim, buttons,
  scrubber, quality matrix) matches.
- Focus: the references show the first control focused on load (scaled card, heavy shadow, ringed Today, white back
  button). The frozen captures draw the same state; at runtime the tvOS focus engine replaces the web's hover and
  focus-visible styling, with the same scale and shadow values for the focused card.
- Fonts: tvOS embeds `docs/parity/fonts/NunitoSans-wght-web.ttf` (the web's exact instance) and JetBrains Mono, with
  the weight axis set per element from the web's computed CSS weights.
- The profile switcher omits the web's "Clients" link (a download page that does not apply on Apple TV).
- Downloads: Apple TV keeps no offline copies, so the page shows the web's header, storage line and empty state with a
  note instead of the web's local download list.
- Profile avatars the web draws as SVG are drawn natively from the same shape data and follow the server preset.
- Rail order on Home can differ by run on a slow runner: three fixture movies are added within one clock second and
  the server breaks ties by sort title, so a run that straddles a second boundary orders them differently from the
  committed reference (seen once in about ten runs; the shared reference run did not straddle one).

## Not covered / follow-ups

- The calendar is a month grid in this baseline; the TV references are being re-captured with a real TV platform
  identity, where the calendar is an agenda list and the player chrome loses volume, fullscreen and the HD badge. The
  next re-baseline follows those references.
- Per-episode download buttons wait for the web.
