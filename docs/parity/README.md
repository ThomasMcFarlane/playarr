# Pixel parity tooling

Native clients must match the web client pixel for pixel on the same fixture data, screen and viewport.
Web is the source of truth: fix the native client, not the web reference. If the web looks wrong, report it.

| Layout | CSS viewport | DPR | Device pixels | Reference for |
| --- | --- | --- | --- | --- |
| `tv` | 1920x1080 | 1 | 1920x1080 | Android TV, tvOS |
| `mobile` | 390x844 | 3 | 1170x2532 | iOS, Android phone |

Every screen is captured and diffed in both themes, `light` and `dark`. A native client must match both,
whether it follows the system appearance or its own theme setting.

Acceptance per screen and theme: at most 1% of pixels mismatched (pixelmatch threshold 0.1, anti-aliasing ignored), or a
written, owner-reviewable justification for an unavoidable platform difference (system status bar, OS font
rasterisation).

## Files

- `scripts/parity/screens.json`: the canonical screen list. Ids: `home`, `movies`, `series`, `film-detail`,
  `series-detail`, `search`, `calendar`, `settings`, `player-controls`, `player-quality-menu`,
  `profile-switcher`, `household-blocked`. Each has the web route, the fixture user (default `fx-viewer`, the
  household screen uses `fx-child-locked`), the steps to reach the state and the layouts.
- `scripts/parity/capture-web.mjs`: Playwright captures of the web reference.
- `scripts/parity/diff.mjs`: pixelmatch diff, per-screen mismatch table and an HTML report.
- `docs/parity/web/<layout>/<theme>/<id>.png`: committed web reference captures (placeholder artwork only), plus
  `manifest.json`. (The earlier unthemed `<layout>/<id>.png` references are now `<layout>/light/<id>.png`.)

## Setup

```sh
cd scripts/parity && npm ci          # pixelmatch, pngjs, playwright-core
npx playwright-core install chromium # once, or set PARITY_CHROMIUM to a Chromium binary
```

## Capture the web reference

1. Build the web client and bring up the fixture server serving it (see
   `docs/validation/fixture-environment.md`; use your own `PLAYARR_FIXTURE_DIR` and ports on a shared host):

   ```sh
   cd clients/tv-web && pnpm install --frozen-lockfile && pnpm -r --filter "@playarr-tv/web^..." run build
   cd web && pnpm exec vite build --outDir /path/to/dist
   PLAYARR_FIXTURE_CLIP_SECONDS=60 PLAYARR_WEB_ASSETS_DIR=/path/to/dist scripts/fixtures/up.sh
   ```

2. Capture:

   ```sh
   node scripts/parity/capture-web.mjs --base http://127.0.0.1:18484 --out docs/parity/web
   # options: --layouts tv,mobile  --theme light|dark|both (default both)  --screens home,search
   #          --clock 2026-10-07T12:00:00Z
   ```

Themes: each page is opened with `prefers-color-scheme` emulation set to the theme and with the app's own
explicit choice stored (`localStorage` key `playarr-theme` set to `light` or `dark`, see
`clients/tv-web/web/src/lib/theme.tsx`), so the result is the same whether a user follows the system or picked
the theme. The theme list and storage key are in `screens.json`.

Platform profile options (off by default): `--safe-area top,bottom[,left,right]` emulates system bars as CSS
safe-area insets and `--font <file>` renders all text with one font file, for comparing against a client whose
platform differs (see `docs/parity/android-mobile/`). `--color-scheme` is an alias of `--theme`. The committed
shared references use neither: they use the web's own font stack and no artificial safe area.

Determinism: the page clock is frozen (`--clock`, default `2026-10-07T12:00:00Z`), reduced motion is on,
animations and transitions are forced off, scrollbars and the caret are hidden, the locale is `en-GB` and the
time zone UTC. The fixture server serves procedural placeholder artwork (`scripts/fixtures/art.mjs`), so every client
draws the same pictures, and `seed.mjs` pins every profile avatar to one preset (the default is derived from
a random user id). Each page logs in afresh as the fixture user with a stable device id.

The player screens use a real decoded frame: the capture seeks the paused player to 2.0 s of the 60 s test clip
(`PLAYARR_FIXTURE_CLIP_SECONDS=60`, start the fixture with it set so the clip does not end first), then
reveals the controls. They run with the real clock, because a frozen `Date` stalls playback start; nothing
date-dependent is on screen. Native clients should seek to 2.0 s, pause, and compare including the video area.

Known source of difference, which is data and not layout: the calendar shows dates relative to the frozen clock
and the seeding day (the unaired episode is seeded three days ahead), so seed the fixture on the capture day or
pass a matching `--clock` (the fixture clips and sources are otherwise fixed).

Reproducibility: two consecutive captures of the same fixture database differ by at most 0.05% of pixels per
screen (dark mobile re-run: 0.00 to 0.05%, the calendar and film detail being the largest), so the 1% budget
leaves room for real layout differences only. Rail order and artwork depend on the fixture database, which is
why `seed.mjs` syncs the sources one after another (it used to race) and artwork is generated from fixed
palettes; the references were re-captured for both themes on one fresh database from current main, with the
fixture seeded the same day as the frozen clock (2026-10-07) and `PLAYARR_FIXTURE_CLIP_SECONDS=60`. Capture the
web again after changing the fixtures or the web client.

## Canonical web mobile bottom navigation

One list for every native phone client (`PRODUCT_NAV_GROUPS` in `clients/tv-web/web/src/lib/productSurfaces.ts`,
rendered in `App.tsx`). Items are 44x46 px icons with a 2 px gap in a 58 px high pill that scrolls horizontally;
the active item is a filled dark tile. Order, left to right:

| # | Item | Route | Shown when |
| --- | --- | --- | --- |
| 1 | Downloads | `/downloads` | the user may download and download storage exists |
| 2 | Search | `/search` | always |
| 3 | Home | `/` | always |
| 4 | Series | `/series` | the catalogue has series |
| 5 | Movies | `/movies` | the catalogue has films |
| 6 | Sites | `/sites` | the catalogue has site works |
| 7 | Music | `/music` | the catalogue has artists |
| 8 | Playlists | `/playlists` | always |
| 9 | Watchlist | `/watchlist` | always |
| 10 | Requests | `/requests` | always |
| 11 | Calendar | `/calendar` | always |
| 12 | Folders | `/folders` | folder roots are registered (placed after Music) |

For `fx-viewer` on the fixture server (films and series, no sites, music or folder roots, downloads available)
that is nine items: Downloads, Search, Home, Series, Movies, Playlists, Watchlist, Requests, Calendar. At 390 CSS px
only eight fit: the ninth (Calendar) is clipped at the right edge and reached by scrolling the bar, so a capture
of the bar shows eight icons. Both counts the native workers reported are therefore right; the list above is the
reference, and the clipped ninth item is expected.

## Diff a native capture

Name native captures `<dir>/<layout>/<theme>/<id>.png` at the layout's device pixel size (a different size is
compared on the larger canvas and the missing area counts as mismatch; an unthemed `<dir>/<layout>/<id>.png` is
still read as the light theme), then:

```sh
node scripts/parity/diff.mjs --ref docs/parity/web --cand <dir> --layout mobile [--theme light|dark|both] [--screens home,search] [--out <dir>/diff-mobile]
```

`--theme` defaults to `both`: the candidate directory of each theme is diffed against the matching reference. It
prints one per-screen table per theme and writes `report.json` (a `themes` object), `summary.md` and `report.html`
(one section per theme, reference, candidate and diff side by side) to `--out`. `--fail` exits non-zero when any
compared screen is over `--max` (default 1) or has no candidate.

Commit native captures and the `summary.md` under `docs/parity/<client>/`; keep the PNGs small.
