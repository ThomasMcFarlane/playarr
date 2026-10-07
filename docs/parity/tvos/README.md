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

Final run: https://github.com/ThomasMcFarlane/playarr/actions/runs/37606853654 (against the #147 TV-identity references).

## Mismatch per screen (percent, against the shared references)

| Screen | Dark | Light |
| --- | --- | --- |
| home | 0.80 | 0.93 |
| movies library | 0.51 | 0.62 |
| series library | 0.80 | 0.87 |
| title detail (film) | 0.53 | 0.60 |
| title detail (series, seasons) | 0.85 | 0.85 |
| search with results | 0.46 | 0.62 |
| release calendar (agenda) | 0.84 | 0.85 |
| settings | 0.77 | 0.76 |
| profile switcher | 0.70 | 0.80 |
| household blocked (fx-child-locked) | 0.41 | 0.39 |
| player, controls visible (video masked) | 0.19 | 0.19 |
| player, quality menu open (video masked) | 0.92 | 0.92 |
| Downloads, Watchlist, Requests (local capture) | 0.27 to 0.36 | 0.27 to 0.38 |

All 24 shared captures are at or under 1%.

## Justified differences

- Player screens: the fixture clips are Matroska and the runner cannot transcode, so the native player cannot play
  them there. The video layer is the server's own frame of the clip at 2.0 s (the endpoint the chapter thumbnails use),
  colour-corrected for the browser's conversion. As on Android, the decoded video is masked on both sides
  (`scripts/parity/apple/mask-video.mjs` copies every pixel outside the chrome from the reference), so the numbers
  compare the chrome only: top buttons, the scrubber and transport band and, with the menu open, the quality panel
  including its backdrop blur (the web's `blur(24px) saturate(120%)` over a 0.9 tint; the native route blurs its copy of
  the frame the same way and playback uses the system material over the live video). The unmasked captures remain in
  the workflow artifact.
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

- Downloads on the detail pages: web PR #117 added a season Download button and a title Download button (there is no\n  per-episode button). tvOS draws both and makes them focusable; they explain that Apple TV keeps no offline copies.
- The calendar Play button shows only for entries whose media is on disk, as on the web.
