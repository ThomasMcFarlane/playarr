# Apple TV (tvOS) parity with the web TV layout

Reference: the web client at 1920x1080 (1x) served by the fixture server; candidate: the tvOS app in the
Apple TV Simulator at 1080p. Both run in one job of `.github/workflows/parity-apple.yml` (GitHub-hosted
`macos-latest`) against the same fixture server instance, signed in as `fx-viewer` (the household blocked
screen as `fx-child-locked`), with the clock frozen at 2026-07-29 05:59 UTC, animations off and the same
placeholder artwork. Mismatch is pixelmatch (threshold 0.1) over all pixels; the target is 1% or less.
Every screen is captured in light and dark (`-PlayarrTheme`, web `playarr-theme`).

How a screen is reached: `-PlayarrServerURL`, `-PlayarrAccessToken` and `-PlayarrParityRoute <route>`
(`home`, `movies`, `series`, `detail:<kind>:<title>`, `search:<query>`, `settings`, `calendar`, `profiles`,
`player:<title>[:quality]`, `household-blocked`). The routes use real server data; nothing is painted from
the reference. The captures here are the native frames, stored at half size (960x540, 64 colours) to keep
the repository small; the workflow artifact has the full-size native, reference and diff images, the web
layout dump (`dom/*.json`) and an HTML report.

Final run: https://github.com/ThomasMcFarlane/playarr/actions/runs/37557581954 (head 37c1547).

## Mismatch per screen (percent)

Before = the first run of the harness (production tvOS views with real data, 7 of the 12 screens existed;
the first frames were also almost empty, so those figures understate the gap). After = the final run.

| Screen | Before (dark) | After dark | After light |
| --- | --- | --- | --- |
| home | 4.82 | 0.79 | 0.95 |
| movies library | 17.17 | 0.51 | 0.58 |
| series library | 4.62 | 0.81 | 0.88 |
| title detail (film) | 3.68 | 0.42 | 0.50 |
| title detail (series, seasons) | 2.48 | 2.00 (see below) | 0.81 |
| search with results | 1.04 | 0.47 | 1.00 |
| settings | 2.20 | 0.80 | 0.81 |
| release calendar | no screen | 0.36 | 0.36 |
| profile switcher | no screen | 0.72 | 0.82 |
| player, controls visible | no screen | 0.11 | 0.11 |
| player, quality menu open | no screen | 0.46 | 0.46 |
| household blocked (fx-child-locked) | no screen | 0.38 | 0.36 |

23 of 24 captures are at or under 1%. Earlier runs of the same build gave series detail (dark) 0.71 to 0.78
and 2.0 to 4.3 on others: the web's own scripted centring of the active season track settles at a heading
y of 395, 410 or (mid animation) 302 depending on the run, while the native layout uses 410. The capture now
waits for that scroll to stop, but the settled value still differs by run and theme. This is a web capture
instability, not a native layout error; a second web run (or pinning the scroll in the web capture) removes it.

## Justified differences

- Player screens are compared with the video picture hidden on both sides (a black stage). The decoded video
  frame differs between Chrome and AVFoundation (scaler, colour handling), which is a platform difference and
  not UI. The chrome (scrim, buttons, scrubber, quality matrix) is compared pixel for pixel.
- Chapter and similar-title frames come from the same server thumbnail endpoint; JPEG decoding and the
  episode art wash differ by a few levels at most.
- Focus: the web shows the first control focused on load (scaled 1.025 to 1.06 with a heavy shadow, the
  settings back button white, Today ringed). The frozen captures draw the same state. At runtime tvOS owns the
  focus engine, so its lift and parallax effects replace the web's hover and focus-visible styling; the
  native cards keep the web's scale and shadow values for the focused state.
- Fonts: both clients use Avenir Next today. The web is moving to bundled Nunito Sans and JetBrains Mono; the
  tvOS client will embed the same files once they are documented (the numbers above are with Avenir Next).
- The profile switcher omits the web's "Clients" link (a download page that does not apply on Apple TV).
- Downloads, Watchlist and Requests are in the nav as on the web but show an honest "not available on Apple
  TV yet" state (row 641); they are not in the parity screen list.
- Artwork the web draws as SVG (profile avatars) is drawn natively from the same shape data and follows the
  server-backed preset.
