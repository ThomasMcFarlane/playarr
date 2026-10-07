# Roku pixel parity (1920x1080)

Reference: the shared web TV captures in `docs/parity/web/tv/{light,dark}`. Candidate: the sideloaded channel on a
physical Roku (fhd), screenshotted through the dev installer's `plugin_inspect` endpoint (JPEG, converted to PNG),
signed in as `fx-viewer` against a fresh deterministic fixture server. Diff: `scripts/parity/diff.mjs`, pixelmatch
threshold 0.1, with the shell clock rectangle (x 470-730, y 60-100) masked because a Roku has no way to freeze its clock.

```
ROKU_DEV_TARGET=<ip> ROKU_DEV_PASSWORD=<dev password> node scripts/parity/roku/capture.mjs <out> dark
node scripts/parity/diff.mjs --ref docs/parity/web --cand <out> --layout tv --theme dark --mask-rect 470,60,260,40
```

## Mismatch per screen (dark theme)

| Screen | Before this change | Now | Light | Status |
| --- | ---: | ---: | --- | --- |
| home | 7.32% | 5.75% | not supported | open |
| movies | 7.50% | 6.27% | not supported | open |
| series | 5.47% | 5.01% | not supported | open |
| film-detail | 8.33% | 10.14% | not supported | open |
| series-detail | 6.15% | 6.08% | not supported | open |
| search | 3.69% | 3.69% | not supported | open |
| profile-switcher | 5.63% | 5.63% | not supported | open |
| calendar, settings and its panels, downloads, watchlist, requests, player-controls, player-quality-menu, household-blocked | n/a | n/a | n/a | no Roku screen / not captured |

"Before" is the capture of the build before the Roku bugfix PR (row 758) except film-detail, whose earlier capture was a
different title. film-detail got worse than the first figure only because the earlier capture did not land on the same
film; it is not a regression of the layout.

## Why nothing is at or below 1% yet

- **Typeface.** Web uses Nunito Sans (`docs/parity/fonts`). The Roku channel draws every label with the system font
  scaled to size: an earlier on-device attempt to attach a custom `Font` child rendered no text at all (see
  `source/Theme.brs`), and the Roku font loader has no variable weight axis, so static instances of the web font would have
  to be generated and verified on the device first. Text edges alone account for a large share of every figure above.
- **Missing chrome.** The Roku has no Downloads, Watchlist, Requests or Calendar screens, so the left dock has four
  fewer entries than web, and there is no "Customise Home" pill. Adding dead entries would be dishonest; they come with
  the features (rows 133, 212, 415).
- **Light theme.** The channel is dark only (the sign-in screen has its own light variant). Every colour is a literal
  in the SceneGraph files, so light needs a token pass over all screens first.
- **Player.** The video plane is a hardware surface that the screenshot endpoint returns black, so the player screens
  can only be compared on their chrome, which is not captured yet.
- **Calendar, settings, lists.** Not implemented on Roku.

## What changed in this step

- Cards use the work's backdrop (the web 16:9 art with the title in it) instead of the poster.
- Home hero title line pitch matches web (`lineSpacing`), hero fade, clock, rail geometry and focus ring from the bugfix PR.
- `scripts/parity/roku/capture.mjs` drives the device over ECP and writes the layout `diff.mjs` reads.

Captures are not committed: the device only produces JPEG screenshots ,
and the report is reproducible with the commands above.
