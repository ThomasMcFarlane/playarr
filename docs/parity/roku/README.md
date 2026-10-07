# Roku pixel parity (1920x1080)

Reference: the shared web TV captures in `docs/parity/web/tv/{light,dark}`. Candidate: the sideloaded channel on a
physical Roku (fhd), screenshotted through the dev installer's `plugin_inspect` endpoint (JPEG, converted to PNG),
signed in as `fx-viewer` against a fresh deterministic fixture server. Diff: `scripts/parity/diff.mjs`, pixelmatch
threshold 0.1, with the shell clock rectangle (x 470-730, y 60-100) masked because a Roku has no way to freeze its clock.

```
ROKU_DEV_TARGET=<ip> ROKU_DEV_PASSWORD=<dev password> node scripts/parity/roku/capture.mjs <out> dark
node scripts/parity/diff.mjs --ref docs/parity/web --cand <out> --layout tv --theme dark --mask-rect 470,60,260,40
```

## Mismatch per screen (device captures, fixture clock masked)

| Screen | Dark | Light | Status |
| --- | ---: | ---: | --- |
| home | 5.74% | 32.41% | open |
| movies | 6.40% | 25.01% | open |
| series | 5.14% | not re-measured | open |
| film-detail | 10.27% | not re-measured | open |
| series-detail | 6.11% | not re-measured | open |
| search | 3.68% | 22.89% | open |
| profile-switcher | 5.53% | 7.02% | open |
| calendar, settings and its panels, watchlist, requests, player-controls, player-quality-menu, household-blocked | n/a | n/a | no Roku screen / not captured |
| downloads | n/a | n/a | justified exception: offline storage is not possible on Roku |

The light figures are high because the stage wash, key-art darkening and dock geometry are still tuned for dark; the
theme itself (tokens, preference, every label and panel) now follows the web palette.

## Why nothing is at or below 1% yet

- **Typeface (done).** Web uses Nunito Sans (`docs/parity/fonts`). The channel bundles static instances in
  `clients/roku/fonts` and attaches them from BrightScript through the Font node (`uri` + `size`), which renders text on
  the device; a Font child in the XML does not. Roku has no letter-spacing, so the hero title's negative tracking is a
  justified remaining difference.
- **Missing chrome.** The Roku has no Downloads, Watchlist, Requests or Calendar screens, so the left dock has four
  fewer entries than web, and there is no "Customise Home" pill. Adding dead entries would be dishonest; they come with
  the features (rows 133, 212, 415).
- **Light theme (done).** `source/Theme.brs` holds both web palettes; `ThemeApplyTree` maps each authored literal to its
  token, the preference (System, Light, Dark; System resolves to dark because Roku has no appearance API) is set from
  the sign-in/profile dropdown and Settings, and capture.mjs selects it through that dropdown.
- **Player.** The video plane is a hardware surface that the screenshot endpoint returns black, so the player screens
  can only be compared on their chrome, which is not captured yet.
- **Calendar, settings, lists.** Not implemented on Roku.

## What changed in this step

- Cards use the work's backdrop (the web 16:9 art with the title in it) instead of the poster.
- Home hero title line pitch matches web (`lineSpacing`), hero fade, clock, rail geometry and focus ring from the bugfix PR.
- `scripts/parity/roku/capture.mjs` drives the device over ECP and writes the layout `diff.mjs` reads.

Captures are not committed: the device only produces JPEG screenshots ,
and the report is reproducible with the commands above.
