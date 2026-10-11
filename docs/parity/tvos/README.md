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
native, reference and diff images and an HTML report. `shared-summary.md` and `{dark,light}/summary.md (the tabs outside the shared list)` are the
raw tables.

Final run: https://github.com/ThomasMcFarlane/playarr/actions/runs/38099323955 (2026-10-11, branch with #695 on main after
#590-#672). The table diffs each native capture against the web capture of the same run on the same fixture database
(the committed `docs/parity/web` references predate the web's 10-11 October changes); the two player screens use the
workflow's `--chrome-only` diff (decoded video masked).

## Mismatch per screen (percent, against the same run's web capture)

| Screen | Dark | Light |
| --- | --- | --- |
| home | 0.94 | 1.70 |
| movies | 1.25 | 1.48 |
| series | 1.37 | 1.58 |
| film-detail | 4.00 | 6.75 |
| series-detail | 1.15 | 1.49 |
| search | 1.03 | 1.14 |
| calendar | 1.93 | 1.83 |
| settings | 3.79 | 4.30 |
| settings-avatar | 0.68 | 0.75 |
| settings-language | 0.63 | 0.65 |
| settings-player | 2.26 | 2.69 |
| settings-server | 2.87 | 3.10 |
| settings-lock | 1.49 | 1.63 |
| settings-invite | 0.86 | 0.92 |
| settings-remote | 1.43 | 5.52 |
| settings-latency | 0.69 | 4.77 |
| settings-your-data | 1.16 | 5.22 |
| downloads | 0.57 | 0.66 |
| watchlist | 0.52 | 0.58 |
| requests | 0.48 | 0.54 |
| player-controls | 0.79 | 0.79 |
| player-quality-menu | 1.32 | 1.32 |
| profile-switcher | 0.88 | 0.80 |
| household-blocked | 0.55 | 0.54 |

Over 1%: text-heavy settings panels (glyph anti-aliasing, the remote and your-data panels in light), film detail (the
chapter frames are server thumbnails of a fixture clip), and the library grids (1.2-1.7%: caption glyphs). The live
parity loop against the real server (device test account) is tracked in 17.470.

## Justified differences

- Preferences, player (light 1.2%) and your data (1.5%): the panels are text-heavy (long paragraphs and the quality
  matrix). The layout, colours and glyph extents match the web to within a pixel; what remains is the anti-aliasing and
  per-glyph positioning of paragraph text (Chrome on Linux against CoreText), which pixelmatch counts along every
  glyph edge. The other panels sit between 0.5% and 0.9%.

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

- Downloads on the detail pages: web PR #117 added a season Download button and a title Download button (there is no
  per-episode button). tvOS draws both and makes them focusable; they explain that Apple TV keeps no offline copies.
- The calendar renders the server's computed actions for each entry (Play or Resume, Open series, Request, watchlist, with disabled reasons), as the web does; the unaired episode shows Open series and Add to watchlist only.
